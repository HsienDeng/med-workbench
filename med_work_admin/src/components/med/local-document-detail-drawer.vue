<script lang="ts" setup>
/**
 * 本地文档详情抽屉：元信息 + 分块列表。
 * 迁移自 med-work-frontend LocalDocumentDetailDrawer。
 */
import { onMounted, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';
import {
  Document as DocumentIcon,
} from '@element-plus/icons-vue';

import { downloadDocumentFile, getDocumentDetailApi } from '#/api/med/documents';
import {
  DICT_DOC_TYPE,
  DICT_INDEX_STATUS,
  DICT_SOURCE_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
  FALLBACK_INDEX_STATUS_OPTIONS,
  FALLBACK_SOURCE_TYPE_OPTIONS,
} from '#/constants/med/dictionary';
import type { DocumentDetailResponse } from '#/types/med';

import { useDictionaryOptions } from '#/hooks/use-dictionary-options';

const STATUS_TAG_TYPE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  uploaded: 'info',
  ready: 'success',
  parsing: 'warning',
  failed: 'danger',
};

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(s?: string): string {
  return s ? s.replace('T', ' ').slice(0, 19) : '-';
}

interface Props {
  /** 当前查看的文档 ID；null 时抽屉关闭 */
  docId: number | null;
  onClose: () => void;
}

const props = defineProps<Props>();

const { labels: docTypeLabels } = useDictionaryOptions(
  DICT_DOC_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
);
const { labels: statusLabels } = useDictionaryOptions(
  DICT_INDEX_STATUS,
  FALLBACK_INDEX_STATUS_OPTIONS,
);
const { labels: sourceTypeLabels } = useDictionaryOptions(
  DICT_SOURCE_TYPE,
  FALLBACK_SOURCE_TYPE_OPTIONS,
);

const loading = ref(false);
const error = ref('');
const detail = ref<DocumentDetailResponse | null>(null);

async function load(id: number) {
  loading.value = true;
  error.value = '';
  detail.value = null;
  try {
    detail.value = await getDocumentDetailApi(id);
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : '文档详情加载失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.docId,
  (id) => {
    if (id != null) void load(id);
    else {
      detail.value = null;
      error.value = '';
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (props.docId != null) void load(props.docId);
});

const doc = () => detail.value?.document ?? null;

async function handleDownload() {
  const current = doc();
  if (!current) return;
  try {
    await downloadDocumentFile(current.id, current.file_name);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '下载失败');
  }
}
</script>

<template>
  <el-drawer
    :model-value="docId != null"
    :title="doc()?.title ?? '文档详情'"
    size="640"
    direction="rtl"
    @update:model-value="onClose"
  >
    <div v-loading="loading" class="med-doc-detail">
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
      />

      <template v-else-if="doc()">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="类型">
            {{ docTypeLabels[doc()!.doc_type] ?? doc()!.doc_type }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="STATUS_TAG_TYPE[doc()!.status] ?? 'info'" size="small">
              {{ statusLabels[doc()!.status] ?? '处理中' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="文件名" :span="2">
            <span class="med-doc-file">
              <el-icon style="color: var(--el-color-primary)">
                <DocumentIcon />
              </el-icon>
              {{ doc()!.file_name }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="来源">
            <span v-if="doc()!.source_type === 'ima'">
              <el-tag type="primary" size="small">
                {{ sourceTypeLabels['ima'] ?? 'IMA' }}
              </el-tag>
            </span>
            <span v-else>{{ doc()!.source || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="大小">
            {{ formatBytes(doc()!.file_size) }}
          </el-descriptions-item>
          <el-descriptions-item label="分块 / 向量" :span="2">
            {{ doc()!.chunk_count }} 分块 / {{ doc()!.vector_count }} 向量
          </el-descriptions-item>
          <el-descriptions-item label="上传人">
            {{ doc()!.created_by || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="上传时间">
            <span class="med-mono">{{ formatTime(doc()!.created_at) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="更新时间" :span="2">
            <span class="med-mono">{{ formatTime(doc()!.updated_at) }}</span>
          </el-descriptions-item>
          <el-descriptions-item
            v-if="doc()!.remark"
            label="备注"
            :span="2"
          >
            {{ doc()!.remark }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="doc()!.error_message"
          type="error"
          show-icon
          title="索引失败原因"
          :description="doc()!.error_message"
          class="med-doc-error"
        />

        <div class="med-doc-chunks">
          <div class="med-doc-chunks-head">
            <span>文本分块（{{ detail?.chunks?.length ?? 0 }}）</span>
            <el-button
              type="primary"
              size="small"
              :icon="DocumentIcon"
              @click="handleDownload"
            >
              下载原文件
            </el-button>
          </div>
          <el-empty
            v-if="!(detail?.chunks?.length ?? 0)"
            description="该文档暂无文本分块（可能仍在解析或索引失败）"
            :image-size="80"
          />
          <el-scrollbar v-else max-height="40vh">
            <div
              v-for="chunk in detail?.chunks ?? []"
              :key="chunk.id"
              class="med-doc-chunk"
            >
              <div v-if="chunk.title" class="med-doc-chunk-title">
                {{ chunk.title }}
              </div>
              <div class="med-doc-chunk-meta">
                分块 #{{ chunk.chunk_index }} · {{ chunk.char_count }} 字
              </div>
              <div class="med-doc-chunk-content">{{ chunk.content }}</div>
            </div>
          </el-scrollbar>
        </div>
      </template>

      <el-empty
        v-else-if="!loading"
        description="暂无数据"
        :image-size="80"
      />
    </div>
  </el-drawer>
</template>

<style scoped>
.med-doc-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.med-doc-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  word-break: break-all;
}

.med-doc-error {
  margin: 0;
}

.med-doc-chunks {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.med-doc-chunks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 13px;
}

.med-doc-chunk {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
}

.med-doc-chunk-title {
  font-weight: 600;
  font-size: 12.5px;
  margin-bottom: 4px;
}

.med-doc-chunk-meta {
  color: var(--el-text-color-secondary);
  font-size: 11.5px;
  margin-bottom: 4px;
}

.med-doc-chunk-content {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 100px;
  overflow: auto;
}

.med-mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}
</style>
