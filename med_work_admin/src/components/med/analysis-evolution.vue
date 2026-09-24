<script lang="ts" setup>
/**
 * 分析演变：对比该患者历次 AI 分析中的关注点等级轨迹与诊断结论变化。
 * 迁移自 med-work-frontend AnalysisEvolution。
 */
import { onMounted, ref } from 'vue';

import {
  ArrowDown,
  ArrowUp,
  MagicStick,
  Minus,
  Plus,
} from '@element-plus/icons-vue';

import { getPatientAnalysisEvolution } from '#/api/med/patients';
import type {
  AnalysisEvolutionResponse,
  AttentionTrendItem,
} from '#/types/med';

const LEVEL_COLOR: Record<string, 'danger' | 'warning' | 'primary' | 'info'> = {
  高: 'danger',
  中: 'warning',
  低: 'primary',
};

const TREND_META: Record<
  string,
  { label: string; color: 'danger' | 'success' | 'info' | 'warning'; icon: 'up' | 'down' | 'flat' | 'new' }
> = {
  up: { label: '加重 ↑', color: 'danger', icon: 'up' },
  down: { label: '减轻 ↓', color: 'success', icon: 'down' },
  flat: { label: '持平', color: 'info', icon: 'flat' },
  new: { label: '新出现', color: 'warning', icon: 'new' },
};

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

interface Props {
  patientId: number;
}

const props = defineProps<Props>();

const data = ref<AnalysisEvolutionResponse | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await getPatientAnalysisEvolution(props.patientId);
  } catch {
    data.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function trendMeta(trend: string) {
  return TREND_META[trend] ?? TREND_META.flat!;
}

function trendIcon(name: string) {
  if (name === 'up') return ArrowUp;
  if (name === 'down') return ArrowDown;
  if (name === 'new') return Plus;
  return Minus; // 'flat' 用 - 图标
}

function fullLabel(row: AttentionTrendItem) {
  const full = row.points.length;
  const last = row.points[full - 1];
  if (full > 0 && last && row.latest_level) {
    return `共 ${full} 次 · ${formatTime(last.time).slice(5)}`;
  }
  return `共 ${full} 次`;
}
</script>

<template>
  <div v-loading="loading" class="med-evo">
    <template v-if="data && (data.analyses ?? []).length">
      <el-card shadow="never" class="med-evo-card">
        <template #header>
          <div class="med-evo-head">
            <el-icon style="color: #722ed1"><MagicStick /></el-icon>
            <span>关注点变化</span>
            <span class="med-evo-sub">
              共 {{ (data.attention_trend ?? []).length }} 个关注点，按出现频次排序
            </span>
          </div>
        </template>
        <el-empty
          v-if="!(data.attention_trend ?? []).length"
          description="分析结论中暂无结构化关注点"
          :image-size="80"
        />
        <el-table
          v-else
          :data="data.attention_trend"
          row-key="title"
          size="small"
        >
          <el-table-column label="关注点" min-width="200">
            <template #default="{ row }">
              <span class="med-evo-title">{{ row.title }}</span>
            </template>
          </el-table-column>
          <el-table-column label="出现" width="200" align="center">
            <template #default="{ row }">
              <span class="med-evo-meta">{{ fullLabel(row as AttentionTrendItem) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="等级轨迹" min-width="240">
            <template #default="{ row }">
              <el-tag
                v-for="(point, index) in (row as AttentionTrendItem).points"
                :key="index"
                :type="LEVEL_COLOR[point.level] ?? 'info'"
                size="small"
                class="med-evo-level"
                :title="formatTime(point.time)"
              >
                {{ point.level || '—' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="趋势" width="100">
            <template #default="{ row }">
              <el-tag :type="trendMeta((row as AttentionTrendItem).trend).color" size="small">
                <el-icon class="med-evo-trend-icon"><component :is="trendIcon(trendMeta((row as AttentionTrendItem).trend).icon)" /></el-icon>
                {{ trendMeta((row as AttentionTrendItem).trend).label }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="med-evo-card">
        <template #header>
          <div class="med-evo-head">
            <el-icon style="color: #722ed1"><MagicStick /></el-icon>
            <span>诊断结论演变</span>
            <span class="med-evo-sub">共 {{ (data.diagnosis_timeline ?? []).length }} 条</span>
          </div>
        </template>
        <el-empty
          v-if="!(data.diagnosis_timeline ?? []).length"
          description="分析结论中暂无诊断类条目"
          :image-size="80"
        />
        <el-timeline v-else>
          <el-timeline-item
            v-for="(point, index) in data.diagnosis_timeline"
            :key="`${point.analysis_id}-${index}`"
            :type="index === (data.diagnosis_timeline ?? []).length - 1 ? 'success' : 'primary'"
            placement="top"
          >
            <div class="med-evo-diag-row">
              <span class="med-evo-diag-key">{{ point.key }}</span>
              <el-tag type="success" size="small">分析 #{{ point.analysis_id }}</el-tag>
              <span class="med-evo-meta">{{ formatTime(point.time) }}</span>
            </div>
            <p class="med-evo-diag-text">{{ point.value }}</p>
          </el-timeline-item>
        </el-timeline>
      </el-card>
    </template>

    <el-card v-else-if="!loading" shadow="never">
      <el-empty description="暂无已完成的分析，暂无法对比演变">
        <el-text type="info" size="small">
          完成至少两次 AI 分析后，此处将展示关注点与诊断结论的变化轨迹。
        </el-text>
      </el-empty>
    </el-card>
  </div>
</template>

<style scoped>
.med-evo {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.med-evo-card :deep(.el-card__body) {
  padding: 0;
}

.med-evo-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.med-evo-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}

.med-evo-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-evo-title {
  font-weight: 600;
}

.med-evo-level {
  margin-right: 4px;
}

.med-evo-trend-icon {
  vertical-align: -2px;
  margin-right: 2px;
}

.med-evo-diag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.med-evo-diag-key {
  font-weight: 600;
  font-size: 13px;
}

.med-evo-diag-text {
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
  color: var(--el-text-color-secondary);
  white-space: pre-wrap;
}
</style>
