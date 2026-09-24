<script lang="ts" setup>
/**
 * 病历详情内的「AI 分析结论归档」面板。
 * 已归档展示结论快照；未归档提供从该患者已完成分析中选择的入口。
 * 迁移自 med-work-frontend RecordAiArchivePanel。
 */
import { computed, ref, watch } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';
import { Calendar, DocumentChecked, MagicStick } from '@element-plus/icons-vue';

import { archiveAnalysisToRecord } from '#/api/med/analysis-archive';
import {
  ANALYSIS_TYPES,
  type MedicalRecordItem,
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

function formatTime(iso?: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

interface Props {
  patientId: number;
  record: MedicalRecordItem;
  /** 时间线事件（其中 analysis + done 事件作为归档候选） */
  events: PatientTimelineEvent[];
  /** 归档成功后回调（父级刷新病历列表） */
  onArchived: (updated: MedicalRecordItem) => void;
}

const props = defineProps<Props>();

const open = ref(false);
const selectedId = ref<null | number>(null);
const submitting = ref(false);

/** 候选：该患者已完成（done）的分析事件 */
const candidates = computed(() =>
  props.events.filter(
    (event) => event.event_type === 'analysis' && event.status === 'done',
  ),
);

watch(
  () => open.value,
  (v) => {
    if (!v) return;
    const preferred =
      props.record.ai_conclusion_source_id &&
      candidates.value.some(
        (c) => c.event_id === props.record.ai_conclusion_source_id,
      )
        ? props.record.ai_conclusion_source_id
        : (candidates.value[0]?.event_id ?? null);
    selectedId.value = preferred;
  },
);

async function handleArchive() {
  if (!selectedId.value) {
    ElMessage.warning('请选择要归档的分析结论');
    return;
  }
  try {
    await ElMessageBox.confirm(
      '归档为当前结论快照，确认写入这份病历？',
      '归档 AI 分析结论',
      { confirmButtonText: '归档', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  submitting.value = true;
  try {
    const updated = await archiveAnalysisToRecord(
      props.patientId,
      props.record.id,
      { analysis_id: selectedId.value },
    );
    ElMessage.success('AI 分析结论已归档到病历');
    open.value = false;
    props.onArchived(updated);
  } finally {
    submitting.value = false;
  }
}

const conclusion = computed(() => props.record.ai_conclusion);
const summaryEntries = computed(() => Object.entries(conclusion.value?.summary ?? {}));
const attention = computed(() => conclusion.value?.attention ?? []);
const evidence = computed(() => conclusion.value?.evidence ?? []);
</script>

<template>
  <div
    class="med-archive"
    :class="record.ai_conclusion ? 'med-archive--done' : 'med-archive--todo'"
  >
    <div class="med-archive-head">
      <div class="med-archive-title">
        <el-icon v-if="record.ai_conclusion" style="color: #389e0d">
          <DocumentChecked />
        </el-icon>
        <el-icon v-else style="color: var(--el-color-primary)">
          <MagicStick />
        </el-icon>
        <span class="med-archive-title-text">
          {{ record.ai_conclusion ? 'AI 分析结论（已归档）' : 'AI 分析结论归档' }}
        </span>
        <el-tag
          v-if="record.ai_conclusion_source_id"
          type="success"
          size="small"
        >
          来源分析 #{{ record.ai_conclusion_source_id }}
        </el-tag>
      </div>
      <div>
        <el-button
          v-if="record.ai_conclusion"
          size="small"
          :icon="MagicStick"
          @click="open = true"
        >
          更新归档
        </el-button>
        <el-button
          v-else
          size="small"
          type="primary"
          :icon="MagicStick"
          :disabled="candidates.length === 0"
          @click="open = true"
        >
          归档 AI 结论
        </el-button>
      </div>
    </div>

    <div v-if="record.ai_conclusion" class="med-archive-body">
      <div class="med-archive-meta">
        <el-icon><Calendar /></el-icon>
        归档于 {{ formatTime(record.ai_conclusion_at) }}
      </div>
      <div
        v-for="[label, value] in summaryEntries"
        :key="String(label)"
        class="med-archive-block"
      >
        <div class="med-archive-label">{{ label }}</div>
        <p class="med-archive-text">{{ value }}</p>
      </div>
      <div v-if="attention.length" class="med-archive-block">
        <div class="med-archive-label">关注点</div>
        <div class="med-archive-attention">
          <div
            v-for="(item, index) in attention"
            :key="`${item.title}-${index}`"
            class="med-archive-attention-item"
          >
            <el-tag :type="LEVEL_COLOR[item.level] ?? 'info'" size="small">
              {{ item.level || '提示' }}
            </el-tag>
            <span class="med-archive-attention-title">{{ item.title }}</span>
            <div
              v-if="item.description"
              class="med-archive-attention-desc"
            >
              {{ item.description }}
            </div>
          </div>
        </div>
      </div>
      <div v-if="evidence.length" class="med-archive-meta">
        循证依据：{{ evidence.map((e) => e.source || '未命名来源').join('、') }}
      </div>
      <el-text
        v-if="
          !summaryEntries.length && attention.length === 0 && evidence.length === 0
        "
        type="info"
        size="small"
      >
        该归档结论暂无结构化内容。
      </el-text>
    </div>

    <el-text v-else type="info" size="small" class="med-archive-tip">
      可将该患者的某次已完成 AI 分析结论（结论 / 关注点 / 循证依据）快照归档到此病历，
      便于后续回顾与报告导出。
    </el-text>

    <el-dialog
      v-model="open"
      title="归档 AI 分析结论"
      :width="560"
      destroy-on-close
    >
      <template v-if="candidates.length === 0">
        <el-empty
          description="暂无已完成的分析可归档，请先对该患者发起 AI 分析。"
          :image-size="80"
        />
      </template>
      <template v-else>
        <div class="med-archive-pick">
          <div class="med-archive-tip">
            选择该患者的一条已完成分析（将快照写入「
            {{
              (record.chief_complaint ?? '').slice(0, 20) || '本份病历'
            }}」）：
          </div>
          <el-radio-group v-model="selectedId" class="med-archive-radios">
            <el-radio
              v-for="c in candidates"
              :key="c.event_id"
              :value="c.event_id"
              class="med-archive-radio"
            >
              <el-tag type="success" size="small">
                {{ TYPE_LABEL[c.analysis_type] ?? c.analysis_type }}
              </el-tag>
              <span class="med-archive-radio-title">
                #{{ c.event_id }} {{ c.summary || '' }}
              </span>
              <span class="med-archive-radio-meta">
                <el-icon><Calendar /></el-icon>
                {{ formatTime(c.time) }}
                <span v-if="c.model"> · 模型：{{ c.model }}</span>
                <span v-if="c.operator"> · {{ c.operator }}</span>
              </span>
            </el-radio>
          </el-radio-group>
        </div>
        <el-text type="info" size="small" class="med-archive-tip">
          归档为当前结论快照，重复归档同一来源不会重复写入；再次归档可覆盖为最新结论。
        </el-text>
      </template>
      <template #footer>
        <el-button @click="open = false">取消</el-button>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="candidates.length === 0"
          @click="handleArchive"
        >
          归档
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.med-archive {
  border-radius: 10px;
  padding: 12px 16px;
  border: 1px solid var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.med-archive--done {
  border-color: #b7eb8f;
  background: #f6ffed;
}

.med-archive-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.med-archive-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.med-archive-title-text {
  font-weight: 600;
  font-size: 13.5px;
}

.med-archive-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.med-archive-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-archive-tip {
  display: block;
  margin-top: 6px;
}

.med-archive-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.med-archive-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-archive-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.med-archive-attention {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.med-archive-attention-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.med-archive-attention-title {
  font-weight: 600;
}

.med-archive-attention-desc {
  width: 100%;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
  margin-top: 2px;
}

.med-archive-pick {
  margin-bottom: 12px;
}

.med-archive-radios {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.med-archive-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 0;
}

.med-archive-radio-title {
  font-weight: 600;
  font-size: 13px;
}

.med-archive-radio-meta {
  color: var(--el-text-color-secondary);
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
