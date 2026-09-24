<script lang="ts" setup>
/**
 * AI 助手会话工作台（迁移自 med-work-frontend Assistant）。
 *
 * 布局：
 *   ┌────────┬───────────────────────────────┐
 *   │ 会话栏 │  消息流 / 空态欢迎              │
 *   │  +新建 │  ──────────────────────────── │
 *   │  最近5 │  Composer（输入区 + 三工具）     │
 *   └────────┴───────────────────────────────┘
 *
 * 流式：messages 通过 useChat 管理；agent.request 转给后端 /api/chat/stream。
 * 多会话：useConversationStore 维护列表；切换会话前先保存旧消息，800ms 防抖整存。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { useRoute, useRouter } from 'vue-router';

import { ElMessage } from 'element-plus';
import {
  ChatLineRound,
  Delete,
  Edit,
  Loading,
  MoreFilled,
  Plus,
  Refresh,
} from '@element-plus/icons-vue';

import Composer from '#/components/med/assistant/composer.vue';
import MessageItem from '#/components/med/assistant/message-item.vue';
import WelcomePanel from '#/components/med/assistant/welcome-panel.vue';
import PromptManagePanel from '#/components/med/prompt-manage-panel.vue';
import { getAiConnections, type AIConnectionResponse } from '#/api/med/ai';
import {
  getConversation,
  streamChat,
  updateConversation,
  type ChatCitation,
  type ChatMessageInput,
} from '#/api/med/chat';
import { listPrompts, type PromptTemplate } from '#/api/med/prompts';
import { uploadDocumentApi } from '#/api/med/documents';
import { useConversationStore } from '#/store/conversations';
import { useAccessStore } from '@vben/stores';
import { toPersist, useChat, type ChatMessage } from '#/hooks/med/use-chat';

// ==================== 会话 / 模型 / 提示词 状态 ====================

const conversationsStore = useConversationStore();
const conversations = computed(() => conversationsStore.conversations);
const activeKey = ref('');
const convInitialized = ref(false);
const loadingConversationKey = ref('');
const loadErrorKey = ref('');

const aiConnections = ref<AIConnectionResponse[]>([]);
const selectedModel = ref<null | string>(null);
const modelRef = ref<null | string>(null);
const prompts = ref<PromptTemplate[]>([]);
const selectedPromptId = ref<null | number>(null);
const convPromptMap = ref<Record<string, null | number>>({});
const messageStore = ref<Record<string, ChatMessage[]>>({});
const loadVersion = ref(0);
const saveQueue = ref<Record<string, Promise<unknown>>>({});

const inputText = ref('');
const uploadingFile = ref(false);
const manageOpen = ref(false);
const renaming = ref(false);
const renameInput = ref('');
const messagesRef = ref<HTMLDivElement | null>(null);

const accessStore = useAccessStore();
const canUpload = computed(() =>
  accessStore.accessCodes?.includes('knowledge_document:upload') ?? false,
);

const route = useRoute();
const router = useRouter();

// ==================== useChat（流式消息机） ====================

const { loading, messages, onCancel, onRequest, setMessages } = useChat({
  agent: {
    request: ({ messages: history }, cb) => {
      const persistable: ChatMessageInput[] = history
        .filter((m) => m.role === 'user' || m.status === 'done')
        .map((m) => ({
          content: m.content,
          role: m.role,
        }));
      void streamChat(persistable, {
        model: modelRef.value ?? undefined,
        onChunk: cb.onUpdate,
        onCitations: cb.onCitations,
        onDone: cb.onSuccess,
        onError: cb.onError,
        onThinking: cb.onThinking,
        signal: cb.signal,
        systemPrompt: promptContentRef.value ?? undefined,
      });
    },
  },
});

const promptContentRef = computed<string | null>(() =>
  selectedPromptId.value
    ? prompts.value.find((p) => p.id === selectedPromptId.value)?.content ?? null
    : null,
);

// 模型 → provider 元数据（圆点颜色）
const MODEL_DOT_COLORS = ['#7c4dff', '#2d6cdf', '#0b8f7f', '#c56a1a', '#d6455d'];
const modelMeta = computed(() => {
  const meta: Record<string, { color: string; provider: string }> = {};
  aiConnections.value.forEach((conn, i) => {
    const color = MODEL_DOT_COLORS[i % MODEL_DOT_COLORS.length]!;
    (conn.models ?? []).forEach((m) => {
      if (!meta[m]) meta[m] = { color, provider: conn.display_name ?? conn.provider };
    });
  });
  return meta;
});

const modelOptions = computed(() => {
  const items: { color: string; key: string; label: string }[] = [];
  for (const [modelName, meta] of Object.entries(modelMeta.value)) {
    items.push({ color: meta.color, key: modelName, label: modelName });
  }
  return items;
});

const promptOptions = computed(() => {
  const items: { key: string; label: string; type: 'default' | 'manage' | 'prompt' }[] = [
    { key: 'default', label: '默认助手', type: 'default' },
  ];
  prompts.value.forEach((p) =>
    items.push({ key: `p-${p.id}`, label: p.name, type: 'prompt' }),
  );
  items.push({ key: 'manage', label: '管理提示词…', type: 'manage' });
  return items;
});

const selectedPromptKey = computed(() =>
  selectedPromptId.value ? `p-${selectedPromptId.value}` : 'default',
);

// ==================== 副作用：AI 连接 / 提示词 ====================

onMounted(async () => {
  // AI 连接
  getAiConnections()
    .then((list) => {
      const enabled = list.filter(
        (c) => c.enabled && c.has_api_key && (c.models?.length ?? 0) > 0,
      );
      aiConnections.value = enabled;
      if (!selectedModel.value) {
        const first = enabled[0]?.active_model ?? null;
        selectedModel.value = first;
        modelRef.value = first;
      }
    })
    .catch(() => {
      /* 模型下拉为空不影响主流程 */
    });
  // 提示词
  listPrompts()
    .then((list) => {
      prompts.value = list;
    })
    .catch(() => {
      /* 下拉显示为默认助手 */
    });
  // 会话
  await initialize();
});

watch(selectedModel, (v) => {
  modelRef.value = v;
});

// ==================== 会话：初始化 / 切换 / 新建 / 删除 ====================

async function initialize() {
  try {
    const items = await conversationsStore.loadConversations();
    const requestedKey = (route.query.conversation as string | undefined) ?? undefined;
    const wantsNew = route.query.new === '1';
    let target = items[0];
    if (wantsNew) {
      target = await conversationsStore.ensureDraft();
    } else if (requestedKey) {
      target = items.find((c) => c.key === requestedKey) ?? items[0];
    } else if (conversationsStore.activeKey) {
      target = items.find((c) => c.key === conversationsStore.activeKey) ?? items[0];
    }
    if (!target) target = await conversationsStore.ensureDraft();
    setActiveKey(target.key);
  } catch {
    loadErrorKey.value = 'initial';
    ElMessage.error('对话历史加载失败');
  } finally {
    convInitialized.value = true;
  }
}

function setActiveKey(key: string) {
  activeKey.value = key;
  conversationsStore.selectConversation(key);
  const cached = messageStore.value[key];
  if (cached) {
    setMessages(cached);
  } else {
    setMessages([]);
    if (key) void loadConversation(Number(key));
  }
  // 同步提示词
  const promptId = convPromptMap.value[key];
  selectedPromptId.value = promptId ?? null;
}

async function loadConversation(id: number) {
  const key = String(id);
  const version = ++loadVersion.value;
  loadingConversationKey.value = key;
  loadErrorKey.value = '';
  try {
    const detail = await getConversation(id);
    if (version !== loadVersion.value) return;
    const list: ChatMessage[] = (detail.messages ?? []).map((m) => ({
      citations: m.citations ?? undefined,
      content: m.content,
      id: `${m.role}-${m.content.slice(0, 12)}-${Math.random().toString(36).slice(2, 7)}`,
      role: m.role === 'user' ? 'user' : 'assistant',
      status: m.role === 'assistant' ? 'done' : undefined,
    }));
    messageStore.value[key] = list;
    convPromptMap.value[key] = detail.prompt_id ?? null;
    if (activeKey.value === key) {
      selectedPromptId.value = detail.prompt_id ?? null;
      setMessages(list);
    }
  } catch {
    if (version === loadVersion.value) {
      loadErrorKey.value = key;
      ElMessage.error('会话内容加载失败');
    }
  } finally {
    if (version === loadVersion.value) loadingConversationKey.value = '';
  }
}

function switchActive(key: string) {
  if (key === activeKey.value) return;
  onCancel();
  if (activeKey.value) saveConversation(activeKey.value);
  setActiveKey(key);
}

async function newConversation() {
  try {
    const draft = await conversationsStore.ensureDraft();
    setActiveKey(draft.key);
    void router.replace({ path: '/assistant', query: {} });
  } catch {
    ElMessage.error('新建对话失败');
  }
}

async function handleDelete(key: string) {
  try {
    await conversationsStore.removeConversation(key);
    if (activeKey.value === key) {
      const next = conversations.value[0];
      if (next) setActiveKey(next.key);
      else await newConversation();
    }
  } catch {
    ElMessage.error('删除失败');
  }
}

// ==================== 保存（800ms 防抖 + 串行队列） ====================

let saveTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  [messages, convInitialized, activeKey],
  () => {
    if (!convInitialized.value || !activeKey.value) return;
    if (messages.value.some((m) => m.status === 'loading')) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (activeKey.value) saveConversation(activeKey.value);
    }, 800);
  },
  { deep: true },
);

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
  if (activeKey.value) void saveConversation(activeKey.value);
  onCancel();
});

async function saveConversation(key: string) {
  const list = messageStore.value[key] ?? messages.value;
  const item = conversations.value.find((c) => c.key === key);
  if (!item) return;
  const persistable = toPersist(list);
  if (!persistable.length) return;
  const previous = saveQueue.value[key] ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => {
    return updateConversation(Number(key), {
      messages: persistable as ChatMessageInput[],
      title: item.label,
    });
  });
  saveQueue.value[key] = pending;
  try {
    await pending;
  } catch {
    ElMessage.warning('对话保存失败，请稍后重试');
  }
}

// ==================== 发送 ====================

function handleSend(text: string) {
  if (!activeKey.value || !onRequest(text)) return;
  inputText.value = '';
  // 新对话自动按首条消息前 14 字重命名
  const item = conversations.value.find((c) => c.key === activeKey.value);
  if (item?.label === '新对话') {
    conversationsStore.renameConversation(activeKey.value, text.slice(0, 14));
  }
  nextTick(() => scrollToBottom());
}

function handlePickPrompt(key: string) {
  if (key === 'manage') {
    manageOpen.value = true;
    return;
  }
  const id = key === 'default' ? null : Number(key.slice(2));
  if (id && !prompts.value.some((p) => p.id === id)) return;
  selectedPromptId.value = id;
  if (activeKey.value) {
    convPromptMap.value[activeKey.value] = id;
    void updateConversation(Number(activeKey.value), { promptId: id ?? 0 }).catch(() => {
      /* 持久化失败仅影响下次进入 */
    });
  }
}

function handlePromptsChanged(list: PromptTemplate[]) {
  prompts.value = list;
  if (selectedPromptId.value && !list.some((p) => p.id === selectedPromptId.value)) {
    selectedPromptId.value = null;
  }
}

async function handlePickFile(file: File) {
  if (uploadingFile.value) return;
  uploadingFile.value = true;
  try {
    await uploadDocumentApi({ file, title: file.name });
    ElMessage.success(`「${file.name}」已上传到知识库，可继续向我提问`);
  } catch {
    /* request 拦截器已统一提示 */
  } finally {
    uploadingFile.value = false;
  }
}

// 把当前消息同步进 store
watch(
  messages,
  (v) => {
    if (activeKey.value) messageStore.value[activeKey.value] = v;
    nextTick(() => scrollToBottom());
  },
  { deep: true },
);

function scrollToBottom() {
  if (!messagesRef.value) return;
  messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
}

// ==================== 重命名当前会话 ====================

function startRename() {
  if (!activeKey.value) return;
  const item = conversations.value.find((c) => c.key === activeKey.value);
  renameInput.value = item?.label ?? '';
  renaming.value = true;
}

async function confirmRename() {
  const name = renameInput.value.trim();
  if (!name || !activeKey.value) {
    renaming.value = false;
    return;
  }
  try {
    await updateConversation(Number(activeKey.value), { title: name });
    conversationsStore.renameConversation(activeKey.value, name);
  } catch {
    ElMessage.error('重命名失败');
  } finally {
    renaming.value = false;
  }
}

// ==================== 占位 / 上传 type ====================

const isEmpty = computed(() => messages.value.length === 0);
</script>

<template>
  <div class="med-assistant">
    <!-- 左栏：会话列表 -->
    <aside class="med-aside">
      <div class="med-aside-head">
        <el-button
          type="primary"
          :icon="Plus"
          class="med-aside-new"
          @click="newConversation"
        >
          新建对话
        </el-button>
      </div>
      <el-scrollbar class="med-aside-scroll">
        <div class="med-aside-group-title">
          <el-icon><ChatLineRound /></el-icon>
          <span>最近会话</span>
        </div>
        <ul class="med-aside-list">
          <li
            v-for="c in conversations.slice(0, 5)"
            :key="c.key"
            :class="['med-aside-item', { 'is-active': c.key === activeKey }]"
            @click="switchActive(c.key)"
          >
            <span class="med-aside-label">{{ c.label }}</span>
            <el-dropdown
              trigger="click"
              @command="(cmd: 'delete' | 'rename') => cmd === 'delete' ? handleDelete(c.key) : startRename()"
            >
              <button type="button" class="med-aside-more" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename" :icon="Edit">重命名</el-dropdown-item>
                  <el-dropdown-item command="delete" :icon="Delete" divided>
                    <span style="color: var(--el-color-danger)">删除</span>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </li>
          <li v-if="!conversations.length" class="med-aside-empty">
            暂无会话
          </li>
        </ul>
      </el-scrollbar>
    </aside>

    <!-- 主区：消息流 / 欢迎 -->
    <section class="med-main">
      <header class="med-main-head">
        <div class="med-main-title">
          <template v-if="!renaming">
            <span>{{ conversations.find((c) => c.key === activeKey)?.label ?? '新对话' }}</span>
            <el-button
              v-if="activeKey"
              link
              type="primary"
              size="small"
              :icon="Edit"
              @click="startRename"
            />
          </template>
          <template v-else>
            <el-input
              v-model="renameInput"
              size="small"
              :maxlength="40"
              @keydown.enter="confirmRename"
              @keydown.esc="renaming = false"
            />
            <el-button size="small" type="primary" @click="confirmRename">保存</el-button>
            <el-button size="small" @click="renaming = false">取消</el-button>
          </template>
        </div>
        <div class="med-main-meta">
          <el-button link size="small" :icon="Refresh" @click="initialize">刷新</el-button>
        </div>
      </header>

      <div ref="messagesRef" class="med-main-scroll">
        <div v-if="loadErrorKey" class="med-main-state">
          <el-alert type="error" :closable="false" show-icon title="对话加载失败">
            <el-button @click="activeKey ? loadConversation(Number(activeKey)) : initialize()">
              重试
            </el-button>
          </el-alert>
        </div>
        <div v-else-if="loadingConversationKey === activeKey" class="med-main-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在加载对话…</span>
        </div>
        <div v-else-if="isEmpty" class="med-main-state med-main-state--empty">
          <WelcomePanel @pick="(p: string) => (inputText = p)" />
        </div>
        <div v-else class="med-main-messages">
          <MessageItem
            v-for="m in messages"
            :key="m.id"
            :role="m.role"
            :content="m.content"
            :thinking="m.thinking"
            :status="m.status"
            :citations="m.citations as ChatCitation[] | undefined"
          />
        </div>
      </div>

      <div class="med-main-composer">
        <Composer
          v-model="inputText"
          :loading="loading"
          :disabled="!activeKey || loadingConversationKey === activeKey || !!loadErrorKey"
          :can-upload="canUpload"
          :uploading-file="uploadingFile"
          :model-options="modelOptions"
          :selected-model="selectedModel"
          :prompt-options="promptOptions"
          :selected-prompt-key="selectedPromptKey"
          upload-accept=".pdf,.docx,.txt,.md"
          @send="handleSend"
          @cancel="onCancel"
          @pick-file="handlePickFile"
          @pick-model="(k: string) => (selectedModel = k)"
          @pick-prompt="handlePickPrompt"
        />
      </div>
    </section>

    <el-dialog
      v-model="manageOpen"
      title="提示词管理"
      width="760"
      :close-on-click-modal="false"
      destroy-on-close
      align-center
    >
      <PromptManagePanel :modal-width="640" @changed="handlePromptsChanged" />
    </el-dialog>
  </div>
</template>

<style scoped>
.med-assistant {
  display: flex;
  height: 100%;
  min-height: 0;
  background: linear-gradient(135deg, #eef5ff 0%, #f5f3ff 55%, #f8fbff 100%);
  border-radius: 10px;
  overflow: hidden;
}

.med-aside {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color-lighter);
  background: #fff;
}

.med-aside-head {
  padding: 14px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.med-aside-new {
  width: 100%;
}

.med-aside-scroll {
  flex: 1;
  min-height: 0;
}

.med-aside-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
}

.med-aside-list {
  list-style: none;
  margin: 0;
  padding: 0 6px 12px;
}

.med-aside-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--el-text-color-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 160ms ease;
}

.med-aside-item:hover {
  background: var(--el-fill-color-light);
}

.med-aside-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.med-aside-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.med-aside-more {
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.med-aside-item:hover .med-aside-more,
.med-aside-item.is-active .med-aside-more {
  display: inline-flex;
}

.med-aside-more:hover {
  background: rgb(0 0 0 / 6%);
  color: var(--el-color-primary);
}

.med-aside-empty {
  padding: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-align: center;
}

.med-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.med-main-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: rgb(255 255 255 / 60%);
}

.med-main-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.med-main-title :deep(.el-input) {
  width: 220px;
}

.med-main-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.med-main-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
  scrollbar-color: #cbd5e1 transparent;
  scrollbar-width: thin;
}

.med-main-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 200px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.med-main-state--empty {
  align-items: flex-start;
  min-height: 100%;
  padding-top: 12px;
}

.med-main-messages {
  width: min(100%, 980px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.med-main-composer {
  padding: 12px 24px 18px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: rgb(255 255 255 / 60%);
}

.med-main-composer :deep(.med-composer) {
  max-width: 980px;
  margin: 0 auto;
}

@media (width <= 900px) {
  .med-aside {
    width: 200px;
  }
}

@media (width <= 720px) {
  .med-aside {
    display: none;
  }
}
</style>
