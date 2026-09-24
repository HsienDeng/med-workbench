<script lang="ts" setup>
/**
 * 助手消息下方的知识库引用列表（迁移自 med-work-frontend CitationList）：
 * title + score 标签 + 原文下载按钮 + snippet 展开收起。
 */
import { ref } from 'vue';

import { Document, Download } from '@element-plus/icons-vue';

import { ElMessage } from 'element-plus';

import { downloadDocumentFile } from '#/api/med/documents';
import type { ChatCitation } from '#/api/med/chat';

const props = defineProps<{ citations: ChatCitation[] }>();

const downloadingId = ref<number | null>(null);

async function handleDownload(item: ChatCitation) {
  downloadingId.value = item.document_id;
  try {
    await downloadDocumentFile(
      item.document_id,
      `${item.title.replace(/[《》]/g, '')}.pdf`,
    );
    ElMessage.success(`已开始下载「${item.title}」`);
  } catch {
    /* request 拦截器已统一处理 */
  } finally {
    downloadingId.value = null;
  }
}
</script>

<template>
  <div class="med-citations">
    <div class="med-citations-title">知识库引用（{{ props.citations.length }}）</div>
    <div
      v-for="item in props.citations"
      :key="item.document_id"
      class="med-citation"
    >
      <div class="med-citation-row">
        <el-icon class="med-citation-icon"><Document /></el-icon>
        <span class="med-citation-title">{{ item.title }}</span>
        <el-tag type="primary" size="small" effect="dark">
          {{ Math.round((item.score || 0) * 100) }}%
        </el-tag>
        <el-button
          link
          type="primary"
          size="small"
          :icon="Download"
          :loading="downloadingId === item.document_id"
          @click="handleDownload(item)"
        >
          原文
        </el-button>
      </div>
      <el-collapse-transition>
        <div v-show="item.snippet" class="med-citation-snippet">
          {{ item.snippet }}
        </div>
      </el-collapse-transition>
    </div>
  </div>
</template>

<style scoped>
.med-citations {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.med-citations-title {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-citation {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--el-fill-color-light);
}

.med-citation-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.med-citation-icon {
  color: var(--el-color-primary);
  flex-shrink: 0;
}

.med-citation-title {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.med-citation-snippet {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 80px;
  overflow: auto;
}
</style>
