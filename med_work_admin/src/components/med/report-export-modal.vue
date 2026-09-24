<script lang="ts" setup>
/**
 * 导出患者诊疗分析报告（Word / PDF）。
 * 迁移自 med-work-frontend ReportExportModal：多选患者 + 可选时间范围。
 */
import { ref, watch } from 'vue';

import { ElMessage } from 'element-plus';
import { Document, Download, InfoFilled } from '@element-plus/icons-vue';

import { downloadPatientReport } from '#/api/med/patients';
import type { PatientReportRange, ReportFormat } from '#/types/med';

export interface ReportCandidate {
  id: number;
  name: string;
  patient_no: string;
}

interface Props {
  open: boolean;
  candidates: ReportCandidate[];
  /** 打开时预选中的患者 ID */
  defaultIds?: number[];
  /** 锁定选择（详情页导出当前患者时无需再选） */
  lockSelection?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultIds: () => [],
  lockSelection: false,
});

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'close'): void;
}>();

const ids = ref<number[]>([]);
const range = ref<[string, string] | null>(null);
const format = ref<ReportFormat>('docx');
const submitting = ref(false);

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    ids.value = [...(props.defaultIds ?? [])];
    range.value = null;
    format.value = 'docx';
  },
);

async function handleOk() {
  if (!ids.value.length) {
    ElMessage.warning('请选择要导出的患者');
    return;
  }
  submitting.value = true;
  try {
    const payload: PatientReportRange = {
      start_date: range.value?.[0] ?? undefined,
      end_date: range.value?.[1] ?? undefined,
    };
    // 逐个 await：避免并发触发浏览器的多文件下载拦截
    for (const id of ids.value) {
      await downloadPatientReport(id, payload, format.value);
    }
    ElMessage.success(
      ids.value.length > 1 ? `已导出 ${ids.value.length} 份报告` : '报告已开始下载',
    );
    emit('update:open', false);
    emit('close');
  } finally {
    submitting.value = false;
  }
}

function close() {
  emit('update:open', false);
  emit('close');
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="导出患者诊疗分析报告"
    :width="480"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:open', $event)"
    @close="close"
  >
    <div class="report-export-body">
      <div class="report-export-row">
        <div class="report-export-label">导出格式</div>
        <el-radio-group v-model="format">
          <el-radio-button value="docx">Word（可编辑再打印）</el-radio-button>
          <el-radio-button value="pdf">PDF（版式固定）</el-radio-button>
        </el-radio-group>
      </div>

      <div class="report-export-row">
        <div class="report-export-label">
          选择患者<span v-if="!lockSelection">（可多选）</span>
        </div>
        <el-select
          v-if="!lockSelection"
          v-model="ids"
          multiple
          filterable
          placeholder="请选择患者"
          style="width: 100%"
        >
          <el-option
            v-for="item in candidates"
            :key="item.id"
            :value="item.id"
            :label="`${item.name}　${item.patient_no}`"
          />
        </el-select>
        <el-select
          v-else
          :model-value="ids[0]"
          disabled
          style="width: 100%"
        >
          <el-option
            v-for="item in candidates"
            :key="item.id"
            :value="item.id"
            :label="`${item.name}　${item.patient_no}`"
          />
        </el-select>
      </div>

      <div class="report-export-row">
        <div class="report-export-label">时间范围（可选）</div>
        <el-date-picker
          v-model="range"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </div>

      <el-text type="info" size="small">
        <el-icon style="vertical-align: -2px"><InfoFilled /></el-icon>
        报告包含患者基本信息、所选时间范围内的全部病历记录与 AI 分析（结论 / 关注点 /
        循证依据），导出为可编辑的 Word 文档；留空时间范围表示导出全部记录。
      </el-text>
    </div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :icon="format === 'pdf' ? Download : Document"
        @click="handleOk"
      >
        {{ format === 'pdf' ? '导出 PDF' : '导出 Word' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.report-export-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 4px;
}

.report-export-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.report-export-label {
  font-size: 13px;
}
</style>
