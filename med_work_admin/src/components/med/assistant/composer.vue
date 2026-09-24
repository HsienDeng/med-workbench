<script lang="ts" setup>
/**
 * AI 助手输入区（迁移自 med-work-frontend Assistant.composer）：
 * 自适应 textarea（1-6 行）+ 工具栏（文件上传 / 模型下拉 / 提示词下拉）+ 发送/停止按钮。
 * 三个工具独立对外暴露 props/emits，弹窗在外层管。
 */
import { computed, nextTick, ref, watch } from 'vue';

import {
  CircleClose,
  Paperclip,
  Promotion,
} from '@element-plus/icons-vue';

interface ModelOption {
  color: string;
  key: string;
  label: string;
}

interface PromptOption {
  key: string;
  label: string;
  type: 'default' | 'manage' | 'prompt';
}

interface Props {
  modelValue: string;
  loading: boolean;
  /** 禁用条件：会话未就绪 / 加载中 / 加载失败时整体置灰 */
  disabled?: boolean;
  /** 是否有文件上传权限（无权限时不展示「文件」按钮） */
  canUpload?: boolean;
  /** 是否正在上传文件（按钮 loading + 禁用） */
  uploadingFile?: boolean;
  /** 当前选中模型 key（用于模型下拉高亮） */
  selectedModel?: null | string;
  /** 模型下拉项（key 即模型 ID） */
  modelOptions?: ModelOption[];
  /** 当前选中提示词 key（default / p-{id}），用于提示词下拉高亮 */
  selectedPromptKey?: string;
  /** 提示词下拉项（default / p-{id} / manage） */
  promptOptions?: PromptOption[];
  /** 文件接受类型（逗号分隔），传给隐藏 input */
  uploadAccept?: string;
  /** 占位文本 */
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  canUpload: false,
  disabled: false,
  modelOptions: () => [],
  promptOptions: () => [],
  selectedModel: null,
  selectedPromptKey: 'default',
  uploadAccept: '.pdf,.docx,.txt,.md',
  uploadingFile: false,
  placeholder: '发送消息…',
});

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'send', text: string): void;
  (e: 'cancel'): void;
  (e: 'pick-file', file: File): void;
  (e: 'pick-model', key: string): void;
  (e: 'pick-prompt', key: string): void;
}>();

const textareaRef = ref();
const fileInputRef = ref<HTMLInputElement | null>(null);

const text = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
});

const currentModel = computed(
  () => props.modelOptions.find((m) => m.key === props.selectedModel) ?? null,
);

const currentPrompt = computed(
  () => props.promptOptions.find((p) => p.key === props.selectedPromptKey) ?? null,
);

function handleSend() {
  const value = (text.value ?? '').trim();
  if (!value || props.loading) return;
  emit('send', value);
  nextTick(() => textareaRef.value?.focus());
}

function onKeyDown(e: KeyboardEvent) {
  // Shift+Enter 换行；Enter 提交
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  // 重置 value，允许同一文件再次触发
  target.value = '';
  if (!file) return;
  emit('pick-file', file);
}

watch(
  () => props.disabled,
  (v) => {
    if (!v) nextTick(() => textareaRef.value?.focus());
  },
);
</script>

<template>
  <div :class="['med-composer', { 'is-disabled': disabled }]">
    <input
      ref="fileInputRef"
      type="file"
      hidden
      :accept="uploadAccept"
      @change="onFileChange"
    />

    <el-input
      v-model="text"
      type="textarea"
      :autosize="{ minRows: 1, maxRows: 6 }"
      :placeholder="placeholder"
      resize="none"
      :disabled="disabled"
      @keydown="onKeyDown"
    />

    <div class="med-composer-tools">
      <div class="med-composer-tools-left">
        <button
          v-if="canUpload"
          type="button"
          class="med-tool-pill"
          :disabled="disabled || uploadingFile || loading"
          title="上传文件到知识库"
          @click="fileInputRef?.click()"
        >
          <el-icon v-if="!uploadingFile"><Paperclip /></el-icon>
          <el-icon v-else class="is-loading"><CircleClose /></el-icon>
          <span>文件</span>
        </button>

        <el-dropdown
          v-if="modelOptions.length > 0"
          trigger="click"
          placement="top-start"
          :disabled="loading"
          @command="(cmd: string) => emit('pick-model', cmd)"
        >
          <button
            type="button"
            class="med-tool-pill med-tool-pill--model"
            :disabled="loading"
            title="切换模型"
          >
            <span
              class="med-model-dot"
              :style="{ background: currentModel?.color ?? '#7c4dff' }"
            />
            <span class="med-model-name">
              {{ currentModel ? currentModel.label : '选择模型' }}
            </span>
            <span class="med-tool-caret">▾</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="m in modelOptions"
                :key="m.key"
                :command="m.key"
                :disabled="m.key === selectedModel"
              >
                <span class="med-dropdown-row">
                  <span class="med-model-dot" :style="{ background: m.color }" />
                  {{ m.label }}
                </span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown
          v-if="promptOptions.length > 0"
          trigger="click"
          placement="top-start"
          :disabled="loading"
          @command="(cmd: string) => emit('pick-prompt', cmd)"
        >
          <button
            type="button"
            :class="['med-tool-pill', 'med-tool-pill--prompt', { 'is-active': selectedPromptKey !== 'default' }]"
            :disabled="loading"
            title="切换提示词"
          >
            <span class="med-prompt-name">
              {{ currentPrompt ? currentPrompt.label : '默认助手' }}
            </span>
            <span class="med-tool-caret">▾</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="p in promptOptions"
                :key="p.key"
                :command="p.key"
                :disabled="p.type === 'prompt' && p.key === selectedPromptKey"
              >
                {{ p.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <el-button
        v-if="!loading"
        type="primary"
        :icon="Promotion"
        :disabled="disabled || !text.trim()"
        @click="handleSend"
      >
        发送
      </el-button>
      <el-button v-else type="warning" :icon="CircleClose" @click="emit('cancel')">
        停止
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.med-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 12px 30px rgb(45 67 104 / 10%);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.med-composer:focus-within {
  border-color: #b9cdea;
  box-shadow: 0 0 0 3px rgb(45 108 223 / 10%), 0 12px 30px rgb(45 67 104 / 10%);
}

.med-composer.is-disabled {
  opacity: 0.65;
}

.med-composer :deep(.el-textarea__inner) {
  border: none;
  padding: 4px 6px;
  box-shadow: none;
  resize: none;
  background: transparent;
  font-size: 14px;
  line-height: 24px;
  color: var(--el-text-color-primary);
}

.med-composer :deep(.el-textarea__inner):focus {
  box-shadow: none;
}

.med-composer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.med-composer-tools-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.med-tool-pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: #fff;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.med-tool-pill:hover:not(:disabled) {
  border-color: #c2d3ec;
  background: #f7faff;
}

.med-tool-pill:disabled {
  color: var(--el-text-color-placeholder);
  cursor: not-allowed;
  opacity: 0.7;
}

.med-tool-pill .el-icon {
  flex: none;
  color: #64748b;
  font-size: 14px;
}

.med-tool-pill--model,
.med-tool-pill--prompt {
  max-width: 220px;
  padding-inline: 10px 8px;
}

.med-tool-pill--prompt.is-active {
  border-color: #b8d4ff;
  background: #f0f6ff;
  color: var(--el-color-primary);
}

.med-model-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.med-model-name,
.med-prompt-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.med-tool-caret {
  flex: none;
  color: #98a2b3;
  font-size: 10px;
  margin-left: 2px;
}

.med-dropdown-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
