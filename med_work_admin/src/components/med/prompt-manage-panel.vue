<script lang="ts" setup>
/**
 * 提示词模板卡片网格 + 编辑弹窗（迁移自 med-work-frontend PromptManagePanel）。
 * 由「提示词管理」页面与 Assistant 内的弹窗共用；不区分预设与个人模板，全部可编辑。
 */
import { computed, reactive, ref } from 'vue';

import { ElMessage } from 'element-plus';
import {
  Delete,
  DocumentAdd,
  Refresh,
  Search,
  Lightning,
  CopyDocument,
} from '@element-plus/icons-vue';

import {
  createPrompt,
  deletePrompt,
  listPrompts,
  updatePrompt,
} from '#/api/med/prompts';
import type { PromptTemplate } from '#/api/med/prompts';

interface Props {
  /** 编辑弹窗宽度（页面 680 / 弹窗场景可用默认） */
  modalWidth?: number;
}

const props = withDefaults(defineProps<Props>(), { modalWidth: 640 });

/** 增删改后回调（通知父级刷新下拉选项） */
const emit = defineEmits<{
  (e: 'changed', prompts: PromptTemplate[]): void;
}>();

interface FormValues {
  content: string;
  description?: string;
  name: string;
}

const formRef = ref();
const prompts = ref<PromptTemplate[]>([]);
const loading = ref(true);
const keyword = ref('');
const editOpen = ref(false);
const selected = ref<null | PromptTemplate>(null);
const creating = ref(false);
const saving = ref(false);

const form = reactive<FormValues>({ content: '', description: '', name: '' });

const rules = {
  content: [{ message: '请输入提示词内容', required: true }],
  name: [{ message: '请输入名称', required: true, whitespace: true }],
};

const filtered = computed(() =>
  prompts.value.filter((item) => matchKeyword(item, keyword.value)),
);

/** 名称/描述大小写不敏感的包含匹配 */
function matchKeyword(item: PromptTemplate, kw: string): boolean {
  if (!kw.trim()) return true;
  const k = kw.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(k) ||
    (item.description ?? '').toLowerCase().includes(k)
  );
}

async function reload() {
  loading.value = true;
  try {
    const list = await listPrompts();
    prompts.value = list;
    emit('changed', list);
  } finally {
    loading.value = false;
  }
}

reload();

/** 点击卡片：直接进入编辑 */
function openEdit(item: PromptTemplate) {
  selected.value = item;
  creating.value = false;
  editOpen.value = true;
  Object.assign(form, {
    content: item.content,
    description: item.description ?? '',
    name: item.name,
  });
}

/** 新建空白模板 */
function openCreate() {
  selected.value = null;
  creating.value = true;
  editOpen.value = true;
  Object.assign(form, { content: '', description: '', name: '' });
}

/** 以任意模板为底稿复制新建 */
function openDuplicate(item: PromptTemplate) {
  selected.value = null;
  creating.value = true;
  editOpen.value = true;
  Object.assign(form, {
    content: item.content,
    description: item.description ?? '',
    name: `${item.name} 副本`,
  });
}

function closeEdit() {
  editOpen.value = false;
  creating.value = false;
}

async function handleSave() {
  await formRef.value?.validate();
  saving.value = true;
  try {
    const values: FormValues = { ...form };
    if (creating.value) {
      const created = await createPrompt(values);
      await reload();
      ElMessage.success('提示词已创建');
      selected.value = created;
      creating.value = false;
      Object.assign(form, {
        content: created.content,
        description: created.description ?? '',
        name: created.name,
      });
    } else if (selected.value) {
      await updatePrompt(selected.value.id, values);
      await reload();
      ElMessage.success('提示词已保存');
    }
  } finally {
    saving.value = false;
  }
}

async function handleDelete(item: PromptTemplate) {
  await deletePrompt(item.id);
  ElMessage.success(`已删除「${item.name}」`);
  if (selected.value?.id === item.id) closeEdit();
  await reload();
}
</script>

<template>
  <div class="prompt-panel">
    <div class="prompt-panel-toolbar">
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        class="prompt-panel-search"
        placeholder="搜索提示词名称或描述"
        clearable
        aria-label="搜索提示词"
      />
      <span class="prompt-panel-count">共 {{ prompts.length }} 个模板</span>
      <el-tooltip content="刷新列表" placement="top">
        <el-button
          :icon="Refresh"
          :loading="loading"
          aria-label="刷新列表"
          @click="reload()"
        />
      </el-tooltip>
      <el-button type="primary" :icon="DocumentAdd" @click="openCreate">
        新建提示词
      </el-button>
    </div>

    <div v-if="loading" class="prompt-card-grid">
      <div v-for="i in 4" :key="i" class="prompt-card">
        <el-skeleton animated class="prompt-card-icon">
          <template #template>
            <el-skeleton-item style="width: 36px; height: 36px" />
          </template>
        </el-skeleton>
        <div class="prompt-card-body">
          <el-skeleton animated :rows="2" />
        </div>
      </div>
    </div>

    <div v-else-if="filtered.length" class="prompt-card-grid">
      <div
        v-for="item in filtered"
        :key="item.id"
        class="prompt-card"
        :class="{
          'prompt-card--active': selected?.id === item.id && editOpen,
        }"
        role="button"
        tabindex="0"
        :aria-label="`编辑提示词 ${item.name}`"
        @click="openEdit(item)"
        @keydown.enter="openEdit(item)"
      >
        <div class="prompt-card-icon">
          <el-icon><Lightning /></el-icon>
        </div>
        <div class="prompt-card-body">
          <div class="prompt-card-title" :title="item.name">{{ item.name }}</div>
          <div class="prompt-card-desc" :title="item.description ?? ''">
            {{ item.description || '暂无描述' }}
          </div>
          <div class="prompt-card-preview">{{ item.content }}</div>
        </div>
        <el-popconfirm
          title="删除提示词"
          :description="`确定删除「${item.name}」？引用它的历史会话将回退为默认助手。`"
          confirm-button-text="删除"
          confirm-button-type="danger"
          cancel-button-text="取消"
          @confirm="handleDelete(item)"
        >
          <template #reference>
            <el-button
              type="danger"
              text
              size="small"
              :icon="Delete"
              class="prompt-card-delete"
              :aria-label="`删除 ${item.name}`"
              @click.stop
            />
          </template>
        </el-popconfirm>
      </div>
    </div>

    <el-empty
      v-else-if="prompts.length === 0"
      description="暂无提示词，点击右上角「新建提示词」创建"
      style="margin: 48px 0"
    />
    <el-empty
      v-else
      description="没有匹配的提示词"
      style="margin: 48px 0"
    />

    <el-dialog
      v-model="editOpen"
      :width="modalWidth"
      destroy-on-close
      class="prompt-detail-modal"
      @close="creating = false"
    >
      <template #header>
        <span class="prompt-drawer-title">
          {{ creating ? '新建提示词' : `编辑：${selected?.name ?? ''}` }}
        </span>
      </template>
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent
      >
        <el-form-item label="名称" prop="name">
          <el-input
            v-model="form.name"
            :maxlength="64"
            placeholder="如：病历质控审查"
          />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            :maxlength="255"
            placeholder="一句话说明用途（可选）"
          />
        </el-form-item>
        <el-form-item label="提示词内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :autosize="{ minRows: 12, maxRows: 20 }"
            placeholder="设定 AI 在该提示词下的角色与回答要求…"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div v-if="creating" class="prompt-drawer-footer">
          <el-button @click="closeEdit">取 消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">
            保 存
          </el-button>
        </div>
        <div v-else-if="selected" class="prompt-drawer-footer">
          <el-popconfirm
            title="删除提示词"
            :description="`确定删除「${selected.name}」？引用它的历史会话将回退为默认助手。`"
            confirm-button-text="删除"
            confirm-button-type="danger"
            cancel-button-text="取消"
            @confirm="handleDelete(selected)"
          >
            <template #reference>
              <el-button type="danger" :icon="Delete">删 除</el-button>
            </template>
          </el-popconfirm>
          <div class="prompt-drawer-footer-spacer" />
          <el-button :icon="CopyDocument" @click="openDuplicate(selected)">
            复制新建
          </el-button>
          <el-button @click="closeEdit">取 消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">
            保 存
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.prompt-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 320px;
}

/* 工具栏：搜索 + 统计 + 刷新 + 新建 */
.prompt-panel-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.prompt-panel-search {
  width: 260px;
  max-width: 100%;
}

.prompt-panel-count {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

/* 卡片网格：自适应卡片 */
.prompt-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.prompt-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.prompt-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 2px 8px rgb(22 119 255 / 8%);
}

.prompt-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.prompt-card--active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.prompt-card-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 16px;
}

.prompt-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prompt-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.prompt-card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.prompt-card-preview {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  line-height: 1.6;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* 卡片删除按钮：默认隐藏，hover 浮现 */
.prompt-card-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}

.prompt-card:hover .prompt-card-delete,
.prompt-card:focus-within .prompt-card-delete {
  opacity: 1;
}

.prompt-drawer-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.prompt-drawer-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prompt-drawer-footer-spacer {
  flex: 1;
}

/* 弹窗场景（Assistant 内）：滚动容器 */
:global(.prompt-manage-modal .el-dialog__body) {
  padding-top: 4px;
}

:deep(.prompt-panel-scroll) {
  min-height: 360px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  padding-right: 4px;
}

@media (width <= 640px) {
  .prompt-panel-search {
    width: 100%;
    order: 1;
  }

  .prompt-panel-count {
    margin-left: 0;
  }

  .prompt-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
