<script lang="ts" setup>
/**
 * 文档管理（迁移自 med-work-frontend Documents）：
 * 三个视图——概览 / 本地知识库 / 上传任务（IMA 外部云端知识库接入待后续迭代）。
 *
 * 原版用左侧 antd Menu（本地知识库下展开文档类型子项），本版用顶栏 Tabs
 * 切换视图，文档类型筛选改为 LocalDocumentTable 内的下拉（与状态并列），
 * 更符合 vben 后台风格、布局更紧凑。
 */
import { ref } from 'vue';

import {
  DataAnalysis,
  Folder,
  Refresh,
  Upload,
  UploadFilled,
} from '@element-plus/icons-vue';

import PageHead from '#/components/med/page-head.vue';
import DocOverview from '#/components/med/doc-overview.vue';
import LocalDocumentTable from '#/components/med/local-document-table.vue';
import UploadDocumentModal from '#/components/med/upload-document-modal.vue';
import UploadTasksModal from '#/components/med/upload-tasks-modal.vue';

const tab = ref<'overview' | 'local' | 'tasks'>('overview');
const refreshKey = ref(0);
const docType = ref<string | undefined>(undefined);

const uploadOpen = ref(false);
const tasksOpen = ref(false);

function refreshAll() {
  refreshKey.value += 1;
}

function handleUploadSuccess() {
  uploadOpen.value = false;
  refreshAll();
}
</script>

<template>
  <div class="med-page">
    <PageHead
      :crumbs="[]"
      title="文档管理"
      subtitle="知识库概览与文档全生命周期管理"
    >
      <template #actions>
        <el-button
          v-access:code="'knowledge_document:upload'"
          :icon="Upload"
          @click="uploadOpen = true"
        >
          上传文档
        </el-button>
        <el-button
          :icon="UploadFilled"
          @click="tasksOpen = true"
        >
          上传任务
        </el-button>
      </template>
    </PageHead>

    <el-card shadow="never" class="med-doc-card">
      <el-tabs v-model="tab" class="med-doc-tabs">
        <el-tab-pane name="overview">
          <template #label>
            <span class="med-tab-label">
              <el-icon><DataAnalysis /></el-icon>
              概览
            </span>
          </template>
        </el-tab-pane>
        <el-tab-pane name="local">
          <template #label>
            <span class="med-tab-label">
              <el-icon><Folder /></el-icon>
              本地知识库
            </span>
          </template>
        </el-tab-pane>
      </el-tabs>

      <div class="med-doc-body">
        <div v-show="tab === 'overview'" class="med-doc-pane">
          <div class="med-doc-pane-toolbar">
            <span class="med-doc-sub">知识库规模与质量总览</span>
            <el-button :icon="Refresh" size="small" @click="refreshAll">
              刷新
            </el-button>
          </div>
          <DocOverview />
        </div>
        <div v-show="tab === 'local'" class="med-doc-pane">
          <LocalDocumentTable
            :refresh-key="refreshKey"
            :doc-type="docType"
            :on-doc-type-change="(v) => (docType = v)"
          />
        </div>
      </div>
    </el-card>

    <UploadDocumentModal
      :open="uploadOpen"
      :on-close="() => (uploadOpen = false)"
      :on-success="handleUploadSuccess"
    />
    <UploadTasksModal
      :open="tasksOpen"
      :on-close="() => (tasksOpen = false)"
    />
  </div>
</template>

<style scoped>
.med-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  padding: 16px;
  overflow-y: auto;
}

.med-doc-card :deep(.el-card__body) {
  padding: 0;
}

.med-doc-tabs {
  padding: 0 20px;
}

.med-doc-tabs :deep(.el-tabs__nav-wrap::after) {
  background: transparent;
}

.med-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.med-doc-body {
  padding: 16px 20px 20px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.med-doc-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.med-doc-pane-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.med-doc-sub {
  color: var(--el-text-color-secondary);
  font-size: 12.5px;
}
</style>
