<script lang="ts" setup>
/**
 * 上传任务弹窗：展示本地文档（本地上传 + IMA 搬运）列表及索引进度。
 * 存在「处理中」文档时每 3s 自动轮询刷新，直到全部完成 / 失败。
 * 迁移自 med-work-frontend UploadTasksModal。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import {
  CircleCheck,
  CircleClose,
  Clock,
  Delete,
  Document as DocumentIcon,
  MoreFilled,
  Refresh,
  Switch,
  VideoPlay,
} from '@element-plus/icons-vue';

import {
  deleteDocumentApi,
  listDocumentsApi,
  reindexDocumentApi,
  startDocumentIndexApi,
} from '#/api/med/documents';
import {
  DICT_DOC_TYPE,
  DICT_INDEX_STATUS,
  DICT_SOURCE_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
  FALLBACK_INDEX_STATUS_OPTIONS,
  FALLBACK_SOURCE_TYPE_OPTIONS,
} from '#/constants/med/dictionary';
import type { KnowledgeDocument } from '#/types/med';

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

function formatTime(s: string): string {
  return s ? s.replace('T', ' ').slice(0, 16) : '-';
}

interface Props {
  open: boolean;
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

const items = ref<KnowledgeDocument[]>([]);
const total = ref(0);
const loading = ref(false);
const actingId = ref<number | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await listDocumentsApi({ page: 1, page_size: 10 });
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      void load();
    }
  },
);

onMounted(() => {
  if (props.open) void load();
});

const hasParsing = computed(() => items.value.some((d) => d.status === 'parsing'));
let pollTimer: ReturnType<typeof setInterval> | null = null;
watch(
  [() => props.open, hasParsing],
  ([open, parsing]) => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (open && parsing) {
      pollTimer = setInterval(() => load(), 3000);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function handleReindex(doc: KnowledgeDocument) {
  actingId.value = doc.id;
  try {
    await reindexDocumentApi(doc.id);
    ElMessage.success(`「${doc.title}」已提交重新索引`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    actingId.value = null;
  }
}

async function handleStartIndex(doc: KnowledgeDocument) {
  actingId.value = doc.id;
  try {
    await startDocumentIndexApi(doc.id);
    ElMessage.success(`「${doc.title}」已开始索引，请稍候查看进度`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    actingId.value = null;
  }
}

async function handleDelete(doc: KnowledgeDocument) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${doc.title}」吗？将同时清除其向量与分块，且不可恢复。`,
      '删除文档',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  actingId.value = doc.id;
  try {
    await deleteDocumentApi(doc.id);
    ElMessage.success(`「${doc.title}」已删除`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  } finally {
    actingId.value = null;
  }
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="上传任务"
    :width="960"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && onClose()"
  >
    <template #header>
      <div class="med-task-head">
        <span>上传任务</span>
        <el-button :icon="Refresh" size="small" @click="load()">刷新</el-button>
      </div>
    </template>
    <el-table
      v-loading="loading"
      :data="items"
      row-key="id"
      max-height="55vh"
    >
      <el-table-column label="文档" min-width="240">
        <template #default="{ row }">
          <div class="med-doc-cell">
            <el-icon class="med-doc-cell-icon" style="color: var(--el-color-primary)">
              <DocumentIcon />
            </el-icon>
            <div class="med-doc-cell-meta">
              <div class="med-doc-cell-title">{{ row.file_name }}</div>
              <div class="med-doc-cell-sub">{{ row.title }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">
            {{ docTypeLabels[row.doc_type] ?? row.doc_type }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="90">
        <template #default="{ row }">
          <el-tag
            v-if="row.source_type === 'ima'"
            type="primary"
            size="small"
            effect="plain"
          >
            {{ sourceTypeLabels['ima'] ?? 'IMA' }}
          </el-tag>
          <span v-else class="med-doc-source">{{ row.source || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="90">
        <template #default="{ row }">
          <span class="med-mono med-text-meta">{{ formatBytes(row.file_size) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="分块" width="90">
        <template #default="{ row }">
          <span class="med-mono">{{ row.chunk_count }} chunks</span>
        </template>
      </el-table-column>
      <el-table-column label="索引进度" width="160">
        <template #default="{ row }">
          <span v-if="row.status === 'ready'" class="med-task-status">
            <el-icon style="color: var(--el-color-success)"><CircleCheck /></el-icon>
            已完成
          </span>
          <el-tooltip
            v-else-if="row.status === 'failed'"
            :content="row.error_message || '索引失败，可点击重新索引'"
            placement="top"
          >
            <span class="med-task-status">
              <el-icon style="color: var(--el-color-danger)"><CircleClose /></el-icon>
              失败
            </span>
          </el-tooltip>
          <el-tooltip
            v-else-if="row.status === 'uploaded'"
            content="已登记，尚未取回内容与向量化，点击右侧「开始索引」"
            placement="top"
          >
            <span class="med-task-status">
              <el-icon style="color: var(--el-text-color-secondary)"><Clock /></el-icon>
              未索引
            </span>
          </el-tooltip>
          <div v-else class="med-task-progress">
            <el-progress
              :percentage="row.vector_count > 0 ? 85 : 40"
              :stroke-width="6"
              :show-text="false"
              status="warning"
              :duration="6"
              class="med-task-bar"
            />
            <span class="med-task-status-text">处理中</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="上传时间" width="130">
        <template #default="{ row }">
          <span class="med-mono med-text-meta">{{ formatTime(row.created_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="STATUS_TAG_TYPE[row.status] ?? 'info'" size="small">
            {{ statusLabels[row.status] ?? '处理中' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" align="right" fixed="right">
        <template #default="{ row }">
          <el-dropdown trigger="click">
            <el-button
              link
              type="primary"
              :icon="MoreFilled"
              :loading="actingId === row.id"
              size="small"
            />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-if="row.status === 'uploaded'"
                  :icon="VideoPlay"
                  @click="handleStartIndex(row)"
                >
                  开始索引
                </el-dropdown-item>
                <el-dropdown-item
                  v-else
                  :icon="Switch"
                  :disabled="row.status === 'parsing'"
                  @click="handleReindex(row)"
                >
                  重新索引
                </el-dropdown-item>
                <el-dropdown-item
                  :icon="Delete"
                  divided
                  @click="handleDelete(row)"
                >
                  <span style="color: var(--el-color-danger)">删除文档</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <div class="med-task-footer">
        <span class="med-doc-sub">
          {{
            hasParsing
              ? '部分文档正在向 IMA 取回内容并向量化，列表将自动刷新'
              : `共 ${total} 个文档（IMA 同步）`
          }}
        </span>
        <el-button @click="onClose">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.med-task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.med-doc-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.med-doc-cell-icon {
  flex-shrink: 0;
  font-size: 18px;
}

.med-doc-cell-meta {
  min-width: 0;
}

.med-doc-cell-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.med-doc-cell-sub {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.med-doc-source {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-task-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.med-task-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.med-task-bar {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.med-task-status-text {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.med-task-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.med-doc-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}

.med-text-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
