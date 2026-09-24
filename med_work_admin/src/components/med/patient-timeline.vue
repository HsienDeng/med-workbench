<script lang="ts" setup>
/**
 * 患者诊疗时间线：病历记录与 AI 分析按时间合并展示（倒序）。
 * 迁移自 med-work-frontend PatientTimeline。
 */
import {
  Calendar,
  User,
} from '@element-plus/icons-vue';

import {
  ANALYSIS_TYPES,
  type PatientTimelineEvent,
} from '#/types/med';

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ANALYSIS_TYPES.map((item) => [item.value, item.label]),
);

const LEVEL_COLOR: Record<string, 'danger' | 'warning' | 'primary' | 'info'> = {
  高: 'danger',
  中: 'warning',
  低: 'primary',
};

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

interface Props {
  events: PatientTimelineEvent[];
  loading: boolean;
  /** 点击病历事件：切到病历详情 Tab 并选中该病历 */
  onOpenRecord?: (recordId: number) => void;
}

const props = withDefaults(defineProps<Props>(), { onOpenRecord: undefined });

function isRecord(event: PatientTimelineEvent) {
  return event.event_type === 'medical_record';
}

function openRecord(recordId: number | null) {
  if (recordId == null) return;
  props.onOpenRecord?.(recordId);
}
</script>

<template>
  <el-card v-loading="loading" shadow="never">
    <template #header>
      <div class="med-timeline-head">
        <el-icon style="color: var(--el-color-primary)"><Calendar /></el-icon>
        <span>诊疗时间线</span>
        <span class="med-timeline-sub">共 {{ events.length }} 个事件（病历 + AI 分析）</span>
      </div>
    </template>

    <el-empty
      v-if="!events.length"
      description="暂无病历与分析记录"
      style="padding: 72px 0"
    />

    <el-timeline v-else>
      <el-timeline-item
        v-for="event in events"
        :key="`${event.event_type}-${event.event_id}`"
        :type="isRecord(event) ? 'primary' : 'success'"
        placement="top"
      >
        <template v-if="isRecord(event)">
          <div
            class="med-tl-card med-tl-card--record"
            :class="{ 'med-tl-card--clickable': event.medical_record_id != null }"
            @click="openRecord(event.medical_record_id)"
          >
            <div class="med-tl-row">
              <el-tag type="primary" size="small">病历记录</el-tag>
              <span class="med-tl-title">{{ event.title }}</span>
              <span class="med-tl-meta">
                <el-icon><Calendar /></el-icon>
                {{ formatTime(event.time) }}
              </span>
            </div>
            <div v-if="event.summary" class="med-tl-summary">{{ event.summary }}</div>
          </div>
        </template>

        <template v-else>
          <div class="med-tl-card med-tl-card--analysis">
            <div class="med-tl-row">
              <el-tag type="success" size="small">AI 分析</el-tag>
              <span class="med-tl-title">
                {{ TYPE_LABEL[event.analysis_type] ?? event.analysis_type }}
              </span>
              <el-tag
                :type="event.status === 'done' ? 'success' : 'danger'"
                size="small"
              >
                {{ event.status === 'done' ? '成功' : '失败' }}
              </el-tag>
              <span class="med-tl-meta">
                <el-icon><Calendar /></el-icon>
                {{ formatTime(event.time) }}
              </span>
            </div>
            <div class="med-tl-row med-tl-row--meta">
              <span>模型：{{ event.model || '-' }}</span>
              <span><el-icon><User /></el-icon> {{ event.operator || '-' }}</span>
            </div>

            <div v-if="event.status !== 'done'" class="med-tl-error">
              {{ event.summary || '分析失败' }}
            </div>
            <div v-else class="med-tl-detail">
              <template
                v-for="(value, label) in (event.detail?.summary ?? {})"
                :key="String(label)"
              >
                <div class="med-tl-summary-block">
                  <div class="med-tl-summary-label">{{ label }}</div>
                  <p class="med-tl-summary-text">{{ value }}</p>
                </div>
              </template>

              <div
                v-if="(event.detail?.attention ?? []).length"
                class="med-tl-summary-block"
              >
                <div class="med-tl-summary-label">关注点</div>
                <div class="med-tl-attention">
                  <div
                    v-for="(item, index) in event.detail?.attention ?? []"
                    :key="`${event.event_id}-attention-${index}`"
                    class="med-tl-attention-item"
                  >
                    <el-tag :type="LEVEL_COLOR[item.level] ?? 'info'" size="small">
                      {{ item.level || '提示' }}
                    </el-tag>
                    <span class="med-tl-attention-title">{{ item.title }}</span>
                    <div v-if="item.description" class="med-tl-attention-desc">
                      {{ item.description }}
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="(event.detail?.evidence ?? []).length"
                class="med-tl-summary-block"
              >
                <div class="med-tl-summary-label">循证依据</div>
                <div class="med-tl-evidence">
                  <div
                    v-for="(item, index) in event.detail?.evidence ?? []"
                    :key="`${event.event_id}-ev-${index}`"
                  >
                    · {{ item.source || '未命名来源' }}
                    <span v-if="item.relevance != null">（相关度 {{ item.relevance }}）</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </el-timeline-item>
    </el-timeline>
  </el-card>
</template>

<style scoped>
.med-timeline-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.med-timeline-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}

.med-tl-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 10px 14px;
}

.med-tl-card--record {
  background: #f7f9fc;
}

.med-tl-card--record.med-tl-card--clickable {
  cursor: pointer;
  transition: box-shadow 0.15s;
}

.med-tl-card--record.med-tl-card--clickable:hover {
  box-shadow: 0 2px 8px rgb(22 119 255 / 10%);
}

.med-tl-card--analysis {
  background: #fbfaff;
  border-color: #f0ecff;
}

.med-tl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.med-tl-row--meta {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 11.5px;
}

.med-tl-title {
  font-weight: 600;
  font-size: 13.5px;
}

.med-tl-meta {
  color: var(--el-text-color-secondary);
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.med-tl-summary {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12.5px;
  line-height: 1.6;
}

.med-tl-error {
  margin-top: 8px;
  color: var(--el-color-danger);
  font-size: 12.5px;
}

.med-tl-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.med-tl-summary-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.med-tl-summary-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-tl-summary-text {
  font-size: 13px;
  line-height: 1.7;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.med-tl-attention {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.med-tl-attention-item {
  font-size: 12.5px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.med-tl-attention-title {
  font-weight: 600;
}

.med-tl-attention-desc {
  width: 100%;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
  margin-top: 2px;
}

.med-tl-evidence {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
