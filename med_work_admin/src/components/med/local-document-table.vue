<script lang="ts" setup>
/**
 * 本地知识库文档列表（迁移自 med-work-frontend LocalDocumentTable）：
 * 关键词 / 状态筛选、分页、详情、下载、重新索引与删除，存在处理中任务时轮询。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import {
  Delete,
  Download,
  MoreFilled,
  Refresh,
  Search,
  View,
  Switch,
  VideoPlay,
} from '@element-plus/icons-vue';

import LocalDocumentDetailDrawer from '#/components/med/local-document-detail-drawer.vue';
import {
  deleteDocumentApi,
  downloadDocumentFile,
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
  refreshKey?: number;
  /** 文档类型筛选（undefined 表示全部） */
  docType?: string;
  onDocTypeChange?: (v: string | undefined) => void;
}

const props = withDefaults(defineProps<Props>(), {
  refreshKey: 0,
  docType: undefined,
  onDocTypeChange: undefined,
});

const { labels: docTypeLabels, options: docTypeOptions } = useDictionaryOptions(
  DICT_DOC_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
);
const { options: statusOptions, labels: statusLabels } = useDictionaryOptions(
  DICT_INDEX_STATUS,
  FALLBACK_INDEX_STATUS_OPTIONS,
);
const { labels: sourceTypeLabels } = useDictionaryOptions(
  DICT_SOURCE_TYPE,
  FALLBACK_SOURCE_TYPE_OPTIONS,
);

const keywordInput = ref('');
const keyword = ref('');
const status = ref<string | undefined>(undefined);
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const items = ref<KnowledgeDocument[]>([]);
const loading = ref(false);
const detailId = ref<null | number>(null);

async function load() {
  loading.value = true;
  try {
    const res = await listDocumentsApi({
      doc_type: props.docType,
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      page_size: pageSize.value,
      status: status.value,
    });
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

watch(
  () => [props.refreshKey, props.docType],
  () => {
    page.value = 1;
    load();
  },
);

let keywordTimer: ReturnType<typeof setTimeout> | null = null;
watch(keywordInput, (v) => {
  if (keywordTimer) clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => {
    keyword.value = v;
    page.value = 1;
    load();
  }, 350);
});

const hasParsing = computed(() => items.value.some((d) => d.status === 'parsing'));
let pollTimer: ReturnType<typeof setInterval> | null = null;
watch(
  hasParsing,
  (v) => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (v) {
      pollTimer = setInterval(() => load(), 3000);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (keywordTimer) clearTimeout(keywordTimer);
});

function handleReset() {
  keywordInput.value = '';
  keyword.value = '';
  status.value = undefined;
  page.value = 1;
  props.onDocTypeChange?.(undefined);
}

async function handleDownload(doc: KnowledgeDocument) {
  try {
    await downloadDocumentFile(doc.id, doc.file_name);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '下载失败');
  }
}

async function handleReindex(doc: KnowledgeDocument) {
  try {
    await reindexDocumentApi(doc.id);
    ElMessage.success(`「${doc.title}」已提交重新索引`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '重新索引提交失败');
  }
}

async function handleStartIndex(doc: KnowledgeDocument) {
  try {
    await startDocumentIndexApi(doc.id);
    ElMessage.success(`「${doc.title}」已开始索引，请稍候查看进度`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败');
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
  try {
    await deleteDocumentApi(doc.id);
    ElMessage.success(`「${doc.title}」已删除`);
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}
</script>

<template>
  <div class="med-doc-table">
    <div class="med-doc-toolbar">
      <el-input
        v-model="keywordInput"
        :prefix-icon="Search"
        placeholder="搜索标题 / 文件名"
        clearable
        class="med-doc-search"
      />
      <el-select
        v-model="status"
        placeholder="索引状态"
        clearable
        class="med-doc-status"
        @change="page = 1; load()"
      >
        <el-option
          v-for="o in statusOptions"
          :key="o.value"
          :label="o.label"
          :value="o.value"
        />
      </el-select>
      <el-select
        :model-value="props.docType"
        placeholder="文档类型"
        clearable
        class="med-doc-type"
        @change="(v: string | undefined) => { props.onDocTypeChange?.(v ?? undefined); page = 1; load(); }"
      >
        <el-option
          v-for="o in docTypeOptions"
          :key="o.value"
          :label="o.label"
          :value="o.value"
        />
      </el-select>
      <el-button :icon="Refresh" @click="load()">刷新</el-button>
      <el-button @click="handleReset">重置</el-button>
      <span v-if="hasParsing" class="med-doc-poll-tip">
        存在处理中的文档，列表将自动刷新…
      </span>
    </div>

    <el-table
      v-loading="loading"
      :data="items"
      row-key="id"
    >
      <el-table-column label="文档" min-width="280">
        <template #default="{ row }">
          <div class="med-doc-cell">
            <el-icon class="med-doc-cell-icon" style="color: var(--el-color-primary)">
              <Search />
            </el-icon>
            <div class="med-doc-cell-meta">
              <div class="med-doc-cell-title" :title="row.title">{{ row.title }}</div>
              <div class="med-doc-cell-sub">{{ row.file_name }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">
            {{ docTypeLabels[row.doc_type] ?? row.doc_type }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="110">
        <template #default="{ row }">
          <el-tag
            v-if="row.source_type === 'ima'"
            type="primary"
            size="small"
            effect="plain"
          >
            {{ sourceTypeLabels['ima'] ?? 'IMA' }}
          </el-tag>
          <el-tooltip v-else :content="row.source || '—'" placement="top">
            <span class="med-doc-source">{{ row.source || '—' }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="100">
        <template #default="{ row }">
          <span class="med-mono med-text-meta">{{ formatBytes(row.file_size) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="分块" width="80">
        <template #default="{ row }">
          <span class="med-mono">{{ row.chunk_count }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="STATUS_TAG_TYPE[row.status] ?? 'info'" size="small">
            {{ statusLabels[row.status] ?? '处理中' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="上传时间" width="150">
        <template #default="{ row }">
          <span class="med-mono med-text-meta">{{ formatTime(row.created_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" align="right" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :icon="View"
            size="small"
            @click="detailId = row.id"
          >
            详情
          </el-button>
          <el-dropdown trigger="click">
            <el-button link type="primary" :icon="MoreFilled" size="small" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :icon="Download" @click="handleDownload(row)">
                  下载原文件
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="row.status === 'uploaded'"
                  v-access:code="'knowledge_document:index'"
                  :icon="VideoPlay"
                  @click="handleStartIndex(row)"
                >
                  开始索引
                </el-dropdown-item>
                <el-dropdown-item
                  v-else
                  v-access:code="'knowledge_document:update'"
                  :icon="Switch"
                  :disabled="row.status === 'parsing'"
                  @click="handleReindex(row)"
                >
                  重新索引
                </el-dropdown-item>
                <el-dropdown-item
                  v-access:code="'knowledge_document:delete'"
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

    <div class="med-doc-pagination">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50]"
        :total="total"
        background
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="load()"
        @size-change="load()"
      >
        <template #total>共 {{ total }} 篇</template>
      </el-pagination>
    </div>

    <LocalDocumentDetailDrawer
      :doc-id="detailId"
      :on-close="() => (detailId = null)"
    />
  </div>
</template>

<style scoped>
.med-doc-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.med-doc-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.med-doc-search {
  width: 220px;
}

.med-doc-status {
  width: 120px;
}

.med-doc-type {
  width: 140px;
}

.med-doc-poll-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: auto;
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
  color: var(--el-text-color-primary);
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
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  vertical-align: middle;
}

.med-doc-pagination {
  display: flex;
  justify-content: flex-end;
}

.med-mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}

.med-text-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
