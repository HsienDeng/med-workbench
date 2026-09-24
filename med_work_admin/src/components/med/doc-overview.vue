<script lang="ts" setup>
/**
 * 文档管理「概览」视图：KPI + 文档构成 + 知识质量看板。
 * 迁移自 med-work-frontend DocOverview。
 */
import { onMounted, ref } from 'vue';

import { getKnowledgeOverviewApi } from '#/api/med/documents';
import type { KnowledgeOverview } from '#/types/med';

import KpiCard from '#/components/med/kpi-card.vue';

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const loading = ref(false);
const data = ref<KnowledgeOverview | null>(null);

async function load() {
  loading.value = true;
  try {
    data.value = await getKnowledgeOverviewApi();
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const total = () => data.value?.total_documents ?? 0;
const ready = () => data.value?.ready_documents ?? 0;
const parsing = () => data.value?.parsing_documents ?? 0;
const failed = () => data.value?.failed_documents ?? 0;
const totalSize = () => data.value?.total_size_bytes ?? 0;
const totalChunks = () => data.value?.total_chunks ?? 0;
const totalVectors = () => data.value?.total_vectors ?? 0;

const indexRatio = () => {
  const t = total();
  if (t === 0) return 0;
  return Math.round((ready() / t) * 1000) / 10;
};

const typeTotal = () =>
  (data.value?.doc_type_distribution ?? []).reduce(
    (sum, d) => sum + d.count,
    0,
  );

const typeRows = () => {
  const t = typeTotal();
  return (data.value?.doc_type_distribution ?? []).map((d) => ({
    ...d,
    ratio: t > 0 ? Math.round((d.count / t) * 1000) / 10 : 0,
  }));
};

const qualityRows = () => {
  const t = total();
  return [
    {
      color: '#722ed1',
      label: '向量索引覆盖率',
      ratio: indexRatio(),
      value: `${indexRatio()}%`,
    },
    {
      color: '#fa8c16',
      label: '处理中文档',
      ratio: t > 0 ? Math.round((parsing() / t) * 1000) / 10 : 0,
      value: `${parsing()} 篇`,
    },
    {
      color: '#f5222d',
      label: '索引失败文档',
      ratio: t > 0 ? Math.round((failed() / t) * 1000) / 10 : 0,
      value: `${failed()} 篇`,
    },
  ];
};
</script>

<template>
  <div v-loading="loading" class="med-doc-overview">
    <div class="med-kpi-grid">
      <KpiCard
        label="文档总数"
        icon="docs"
        icon-color="blue"
        :value="String(total())"
        unit="篇"
        :desc="`占用 ${formatBytes(totalSize())}`"
      />
      <KpiCard
        label="已索引"
        icon="valid"
        icon-color="green"
        :value="String(ready())"
        unit="篇"
        :desc="`索引覆盖率 ${indexRatio()}%`"
      />
      <KpiCard
        label="处理中"
        icon="update"
        icon-color="orange"
        :value="String(parsing())"
        unit="篇"
        desc="等待向量化完成"
      />
      <KpiCard
        label="索引失败"
        icon="review"
        icon-color="purple"
        :value="String(failed())"
        unit="篇"
        desc="需检查后重试"
      />
    </div>

    <div class="med-doc-grid">
      <el-card shadow="never" class="med-doc-card">
        <template #header>
          <div class="med-doc-card-head">
            <span>文档构成</span>
            <span class="med-doc-sub">各类型文档占比</span>
          </div>
        </template>
        <div class="med-doc-card-body">
          <template v-if="typeRows().length">
            <div
              v-for="row in typeRows()"
              :key="row.doc_type"
              class="med-doc-bar"
            >
              <div class="med-doc-bar-row">
                <span class="med-doc-bar-label">{{ row.label }}</span>
                <strong>
                  {{ row.count }} 篇
                  <span class="med-doc-bar-ratio">· {{ row.ratio }}%</span>
                </strong>
              </div>
              <el-progress
                :percentage="row.ratio"
                :show-text="false"
                :stroke-width="6"
                :color="[
                  { color: '#1677ff', percentage: 50 },
                  { color: '#722ed1', percentage: 100 },
                ]"
              />
            </div>
          </template>
          <el-empty
            v-else
            description="暂无文档，可在「本地知识库」中上传"
            :image-size="80"
          />
          <div class="med-doc-summary">
            索引规模：<strong>{{ total() }} 篇</strong> · 文本分块
            <strong>{{ totalChunks() }}</strong> · 向量
            <strong>{{ totalVectors() }}</strong>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="med-doc-card">
        <template #header>
          <div class="med-doc-card-head">
            <span>知识质量看板</span>
            <span class="med-doc-sub">知识库健康度指标</span>
            <el-tag
              :type="indexRatio() === 100 ? 'success' : indexRatio() > 0 ? 'primary' : 'warning'"
              size="small"
            >
              {{ indexRatio() }}% 已索引
            </el-tag>
          </div>
        </template>
        <div class="med-doc-card-body">
          <div
            v-for="q in qualityRows()"
            :key="q.label"
            class="med-doc-bar"
          >
            <div class="med-doc-bar-row">
              <span class="med-doc-bar-label">{{ q.label }}</span>
              <strong>{{ q.value }}</strong>
            </div>
            <el-progress
              :percentage="q.ratio"
              :show-text="false"
              :stroke-width="6"
              :color="q.color"
            />
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.med-doc-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.med-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.med-doc-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 12px;
}

@media (width <= 1100px) {
  .med-doc-grid {
    grid-template-columns: 1fr;
  }
}

.med-doc-card :deep(.el-card__body) {
  padding: 16px 20px;
}

.med-doc-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.med-doc-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}

.med-doc-card-head .el-tag {
  margin-left: auto;
}

.med-doc-card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.med-doc-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.med-doc-bar-row {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--el-text-color-primary);
}

.med-doc-bar-label {
  color: var(--el-text-color-secondary);
}

.med-doc-bar-ratio {
  color: var(--el-text-color-secondary);
  font-weight: 400;
}

.med-doc-summary {
  margin-top: auto;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
