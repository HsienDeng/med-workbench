<script lang="ts" setup>
/**
 * 业务仪表盘通用 KPI 卡片（迁移自 med-work-frontend KpiCard）：
 * 数字 + 单位 + 描述 + 角标图标，渐变背景按 iconColor 区分。
 */
import { computed } from 'vue';

import { Document, TrendCharts, Warning, Refresh, DataAnalysis, FirstAidKit, ChatLineRound } from '@element-plus/icons-vue';

interface Props {
  /** 主数字（字符串，避免 0 误判） */
  value: string;
  /** 标签（如「文档总数」） */
  label: string;
  /** 单位（如「篇」），选填 */
  unit?: string;
  /** 描述行（用于展示次级信息，如「占用 12.3 MB」） */
  desc?: string;
  /** 角标图标名：docs / valid / update / review / ai / patient / chat */
  icon?: 'docs' | 'valid' | 'update' | 'review' | 'ai' | 'patient' | 'chat';
  /** 主题色：blue / green / orange / purple / cyan / pink */
  iconColor?: 'blue' | 'green' | 'orange' | 'purple' | 'cyan' | 'pink';
}

const props = withDefaults(defineProps<Props>(), {
  desc: '',
  icon: 'docs',
  iconColor: 'blue',
  unit: '',
});

const ICON_MAP = {
  chat: ChatLineRound,
  docs: Document,
  patient: FirstAidKit,
  review: Warning,
  update: Refresh,
  valid: TrendCharts,
  ai: DataAnalysis,
} as const;

const COLOR_BG: Record<NonNullable<Props['iconColor']>, string> = {
  blue: 'linear-gradient(135deg, #1677ff, #4096ff)',
  cyan: 'linear-gradient(135deg, #13c2c2, #5cdbd3)',
  green: 'linear-gradient(135deg, #52c41a, #95de64)',
  orange: 'linear-gradient(135deg, #fa8c16, #ffc069)',
  pink: 'linear-gradient(135deg, #eb2f96, #ff85c0)',
  purple: 'linear-gradient(135deg, #722ed1, #b37feb)',
};

const ICON_KEY = computed<keyof typeof ICON_MAP>(() => props.icon);
const COLOR_KEY = computed<keyof typeof COLOR_BG>(() => props.iconColor);
</script>

<template>
  <el-card shadow="never" class="med-kpi">
    <div class="med-kpi-icon" :style="{ background: COLOR_BG[COLOR_KEY] }">
      <el-icon><component :is="ICON_MAP[ICON_KEY]" /></el-icon>
    </div>
    <div class="med-kpi-content">
      <div class="med-kpi-label">{{ label }}</div>
      <div class="med-kpi-value">
        <span class="med-kpi-number">{{ value }}</span>
        <span v-if="unit" class="med-kpi-unit">{{ unit }}</span>
      </div>
      <div v-if="desc" class="med-kpi-desc">{{ desc }}</div>
    </div>
  </el-card>
</template>

<style scoped>
.med-kpi {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--el-border-color-lighter);
}

.med-kpi :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  width: 100%;
}

.med-kpi-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgb(22 119 255 / 15%);
}

.med-kpi-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.med-kpi-label {
  color: var(--el-text-color-secondary);
  font-size: 12.5px;
}

.med-kpi-value {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.med-kpi-number {
  font-size: 24px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1.2;
}

.med-kpi-unit {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.med-kpi-desc {
  color: var(--el-text-color-secondary);
  font-size: 11.5px;
}
</style>
