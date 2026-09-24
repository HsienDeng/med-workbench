<script lang="ts" setup>
/**
 * 单条聊天消息（迁移自 med-work-frontend Assistant.renderContent）：
 * - 用户：纯文本气泡
 * - 助手：thinking 折叠 + markdown 正文 + 已停止标记 + 引用列表
 * - 加载中：占位「正在思考…」
 * - 出错：红色文本
 */
import { computed } from 'vue';

import { Loading, User } from '@element-plus/icons-vue';

import { renderMarkdown } from '#/utils/med/markdown';
import type { ChatCitation } from '#/api/med/chat';

import CitationList from './citation-list.vue';
import ThinkingPanel from './thinking-panel.vue';

interface Props {
  role: 'assistant' | 'user';
  /** 正文（assistant 为 markdown 源） */
  content: string;
  /** 推理过程（仅 assistant） */
  thinking?: string;
  /** 消息状态 */
  status?: 'done' | 'error' | 'loading' | 'stopped';
  /** 知识库引用（仅 assistant） */
  citations?: ChatCitation[];
  /** 助手头像（可空，使用 fallback） */
  avatar?: string;
}

const props = defineProps<Props>();

const html = computed(() => renderMarkdown(props.content));

const isUser = computed(() => props.role === 'user');
const isLoadingEmpty = computed(
  () => props.role === 'assistant' && props.status === 'loading' && !props.content && !props.thinking,
);
</script>

<template>
  <div :class="['med-msg', isUser ? 'med-msg--user' : 'med-msg--assistant']">
    <div class="med-msg-avatar">
      <img v-if="!isUser && avatar" :src="avatar" alt="" />
      <el-icon v-else-if="!isUser" class="med-msg-avatar-fallback"><Loading /></el-icon>
      <el-icon v-else><User /></el-icon>
    </div>
    <div class="med-msg-body">
      <div v-if="isUser" class="med-msg-text med-msg-text--user">
        {{ content }}
      </div>
      <div v-else class="med-msg-text med-msg-text--assistant">
        <span v-if="isLoadingEmpty" class="med-msg-loading">
          <el-icon class="is-loading"><Loading /></el-icon> 正在思考…
        </span>
        <template v-else>
          <ThinkingPanel
            v-if="thinking"
            :text="thinking"
            :active="status === 'loading'"
          />
          <div v-if="content" class="med-msg-markdown" v-html="html" />
          <div v-if="status === 'stopped'" class="med-msg-stopped">已停止生成</div>
          <CitationList v-if="citations?.length" :citations="citations" />
        </template>
        <div v-if="status === 'error'" class="med-msg-error">
          {{ content || '对话出错，请稍后重试' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.med-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 6px 0;
}

.med-msg--user {
  flex-direction: row-reverse;
}

.med-msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  font-size: 18px;
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: 0 2px 6px rgb(0 0 0 / 6%);
}

.med-msg-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.med-msg--user .med-msg-avatar {
  background: var(--el-color-primary);
  color: #fff;
}

.med-msg-avatar-fallback {
  font-size: 16px;
}

.med-msg-body {
  min-width: 0;
  max-width: 80%;
  display: flex;
  flex-direction: column;
}

.med-msg--user .med-msg-body {
  align-items: flex-end;
}

.med-msg-text {
  padding: 10px 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  word-break: break-word;
  min-width: 60px;
}

.med-msg-text--user {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
  white-space: pre-wrap;
  color: var(--el-text-color-primary);
}

.med-msg-text--assistant {
  background: #fff;
  border-color: var(--el-border-color-lighter);
}

.med-msg-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.med-msg-stopped {
  display: block;
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-msg-error {
  margin-top: 6px;
  color: var(--el-color-danger);
  white-space: pre-wrap;
  font-size: 13px;
}

.med-msg-markdown {
  line-height: 1.7;
  font-size: 14px;
}

.med-msg-markdown :deep(p) {
  margin: 6px 0;
}

.med-msg-markdown :deep(p:first-child) {
  margin-top: 0;
}

.med-msg-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.med-msg-markdown :deep(h1),
.med-msg-markdown :deep(h2),
.med-msg-markdown :deep(h3),
.med-msg-markdown :deep(h4) {
  margin: 10px 0 6px;
  font-weight: 600;
}

.med-msg-markdown :deep(ul),
.med-msg-markdown :deep(ol) {
  padding-left: 1.4em;
  margin: 6px 0;
}

.med-msg-markdown :deep(li) {
  margin: 2px 0;
}

.med-msg-markdown :deep(pre) {
  margin: 6px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f6f8fa;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.6;
}

.med-msg-markdown :deep(code) {
  font-family: var(--el-font-family-monospace, SFMono-Regular, Consolas, monospace);
  background: rgb(27 37 55 / 6%);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12.5px;
}

.med-msg-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}

.med-msg-markdown :deep(table) {
  border-collapse: collapse;
  width: 100%;
  font-size: 12.5px;
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.med-msg-markdown :deep(table th),
.med-msg-markdown :deep(table td) {
  border: 1px solid var(--el-border-color-lighter);
  padding: 6px 10px;
  text-align: left;
}

.med-msg-markdown :deep(table th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
}

.med-msg-markdown :deep(a) {
  color: var(--el-color-primary);
  text-decoration: none;
}

.med-msg-markdown :deep(a):hover {
  text-decoration: underline;
}
</style>
