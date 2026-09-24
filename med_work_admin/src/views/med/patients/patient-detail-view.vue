<script lang="ts" setup>
/**
 * 患者详情页（迁移自 med-work-frontend PatientDetailView）。
 * 左栏：患者信息 + 病历记录列表；右栏 Tab：病历详情 / 时间线 / 分析演变。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';

import {
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import {
  ArrowLeft,
  Box,
  Calendar as CalendarIcon,
  DataAnalysis,
  DataLine,
  Delete,
  Document as DocumentIcon,
  Download,
  Edit,
  Files,
  MagicStick,
  Plus,
} from '@element-plus/icons-vue';

import PageHead from '#/components/med/page-head.vue';
import PatientTimeline from '#/components/med/patient-timeline.vue';
import RecordAiArchivePanel from '#/components/med/record-ai-archive-panel.vue';
import AnalysisEvolution from '#/components/med/analysis-evolution.vue';
import ReportExportModal, {
  type ReportCandidate,
} from '#/components/med/report-export-modal.vue';
import {
  createMedicalRecord,
  deleteMedicalRecord,
  getMedicalRecords,
  getPatientDetail,
  getPatientTimeline,
  parseMedicalRecordFile,
  updateMedicalRecord,
  updatePatient,
} from '#/api/med/patients';
import type {
  MedicalRecordItem,
  MedicalRecordPayload,
  PatientDetailItem,
  PatientPayload,
  PatientTimelineEvent,
} from '#/types/med';
import {
  DICT_DEPT,
  DICT_PATIENT_STATUS,
  FALLBACK_DEPT_OPTIONS,
  FALLBACK_PATIENT_STATUS_OPTIONS,
} from '#/constants/med/dictionary';
import { useDictionaryOptions } from '#/hooks/use-dictionary-options';

const STATUS_TAG_TYPE: Record<string, 'primary' | 'info' | 'warning' | 'success' | 'danger'> = {
  in: 'primary',
  out: 'info',
  transfer: 'warning',
};

const GENDER_LABEL: Record<string, string> = { male: '男', female: '女' };

function formatTime(iso: string): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 16);
}

function calcBMI(height?: number | null, weight?: number | null): number | null {
  if (height && weight && height > 0) {
    return Math.round((weight / (height / 100) ** 2) * 10) / 10;
  }
  return null;
}

/** 病历字段元信息（新建 / 编辑表单与详情展示共用） */
interface FieldMeta {
  key: keyof MedicalRecordPayload;
  label: string;
  placeholder: string;
  rows: number;
  /** 1 半列 / 2 整行（默认） */
  span?: 1 | 2;
}

const RECORD_FIELDS: FieldMeta[] = [
  { key: 'chief_complaint', label: '主诉', placeholder: '如：反复咳嗽伴发热 3 天', rows: 3, span: 2 },
  { key: 'present_illness', label: '现病史', placeholder: '发病经过、症状演变、院外诊疗经过…', rows: 5, span: 2 },
  { key: 'past_history', label: '既往史', placeholder: '既往疾病、手术、外伤、输血史…', rows: 4 },
  { key: 'allergy_history', label: '过敏史', placeholder: '食物、药物及接触物过敏史', rows: 3 },
  { key: 'drug_allergy_history', label: '药敏史', placeholder: '药物过敏种类与表现', rows: 3 },
  { key: 'family_history', label: '家族史', placeholder: '家族遗传性疾病、肿瘤史等', rows: 3 },
  { key: 'physical_exam', label: '体格检查', placeholder: '生命体征、专科查体所见…', rows: 4, span: 2 },
  { key: 'treatment_advice', label: '处理意见', placeholder: '诊断意见与处置方案', rows: 4, span: 2 },
  { key: 'lab_tests', label: '检验', placeholder: '血常规、生化、尿便常规等', rows: 4 },
  { key: 'examinations', label: '检查', placeholder: '影像、超声、心电图等', rows: 4 },
  { key: 'treatment', label: '治疗', placeholder: '治疗方案、手术、医嘱', rows: 4 },
  { key: 'medications', label: '药品', placeholder: '药名、剂量、用法频次', rows: 4 },
  { key: 'supplements', label: '补充内容', placeholder: '其他需要记录的信息', rows: 3 },
  { key: 'health_education', label: '健康教育', placeholder: '生活方式、复诊与随访指导', rows: 3 },
];

const RECORD_GROUPS: {
  title: string;
  icon: 'DataLine' | 'Box' | 'Files';
  desc: string;
  keys: (keyof MedicalRecordPayload)[];
}[] = [
  {
    title: '病史信息',
    desc: '主诉 · 现病史 · 既往史',
    icon: 'DataLine',
    keys: [
      'chief_complaint',
      'present_illness',
      'past_history',
      'allergy_history',
      'drug_allergy_history',
      'family_history',
    ],
  },
  {
    title: '诊疗信息',
    desc: '查体 · 检验检查 · 治疗用药',
    icon: 'Box',
    keys: ['physical_exam', 'treatment_advice', 'lab_tests', 'examinations', 'treatment', 'medications'],
  },
  {
    title: '其他',
    desc: '补充信息 · 健康宣教',
    icon: 'Files',
    keys: ['supplements', 'health_education'],
  },
];

const PARSE_SOURCE_LABEL: Record<string, string> = {
  image: '图片识别',
  pdf: 'PDF 解析',
  word: 'Word 解析',
  text: '文本解析',
};

const GROUP_ICON_MAP: Record<string, typeof DataLine> = {
  DataLine,
  Box,
  Files,
};

interface Props {
  patientId: number;
  onBack: () => void;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'back'): void;
}>();

// ---------- 字典 ----------
const { options: deptOptions, labels: deptLabels } = useDictionaryOptions(
  DICT_DEPT,
  FALLBACK_DEPT_OPTIONS,
);
const { options: statusOptions, labels: statusLabels } = useDictionaryOptions(
  DICT_PATIENT_STATUS,
  FALLBACK_PATIENT_STATUS_OPTIONS,
);

// ---------- 患者 ----------
const patient = ref<null | PatientDetailItem>(null);
const patientLoading = ref(true);

// ---------- 病历记录 ----------
const records = ref<MedicalRecordItem[]>([]);
const recordsLoading = ref(false);
const activeRecordId = ref<null | number>(null);

// ---------- 时间线 ----------
const timeline = ref<PatientTimelineEvent[]>([]);
const timelineLoading = ref(false);
const rightTab = ref<'record' | 'timeline' | 'evolution'>('record');

// ---------- 报告导出 ----------
const exportOpen = ref(false);

// ---------- 编辑患者 ----------
const patientFormRef = ref();
const patientForm = reactive<
  Omit<PatientPayload, 'birth_date'> & { birth_date?: string | null }
>({
  age: 0,
  allergy_history: '',
  birth_date: null,
  dept: '',
  gender: 'male',
  height: undefined,
  name: '',
  past_history: '',
  phone: '',
  primary_diag: '',
  status: 'in',
  waistline: undefined,
  weight: undefined,
});
const patientModalOpen = ref(false);
const patientSubmitting = ref(false);

const patientRules = {
  age: [{ message: '请输入年龄', required: true }],
  dept: [{ message: '请选择科室', required: true }],
  gender: [{ message: '请选择性别', required: true }],
  name: [{ message: '请输入姓名', required: true }],
  primary_diag: [{ message: '请输入主诊断', required: true }],
  status: [{ message: '请选择状态', required: true }],
};

// ---------- 新建 / 编辑病历 ----------
const recordForm = reactive<MedicalRecordPayload>({});
const recordModalOpen = ref(false);
const editingRecord = ref<null | MedicalRecordItem>(null);
const recordSubmitting = ref(false);
const recordParsing = ref(false);
const parseFileName = ref('');
const lastParse = ref<null | { source: string; count: number }>(null);
const recordFilled = ref(0);

const requiredRecordFields: (keyof MedicalRecordPayload)[] = RECORD_FIELDS.map(
  (f) => f.key,
);

async function loadDetail() {
  patientLoading.value = true;
  try {
    patient.value = await getPatientDetail(props.patientId);
  } finally {
    patientLoading.value = false;
  }
}

async function loadRecords() {
  recordsLoading.value = true;
  try {
    const res = await getMedicalRecords(props.patientId);
    records.value = res.items;
    activeRecordId.value =
      activeRecordId.value && res.items.some((r) => r.id === activeRecordId.value)
        ? activeRecordId.value
        : (res.items[0]?.id ?? null);
  } finally {
    recordsLoading.value = false;
  }
}

async function loadTimeline() {
  timelineLoading.value = true;
  try {
    const res = await getPatientTimeline(props.patientId);
    timeline.value = res.items;
  } finally {
    timelineLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadDetail(), loadRecords(), loadTimeline()]);
});

const activeRecord = computed(
  () => records.value.find((r) => r.id === activeRecordId.value) ?? null,
);

function syncRecordFilled() {
  const values = { ...recordForm } as MedicalRecordPayload;
  const count = Object.values(values).filter(
    (v) => typeof v === 'string' && v.trim().length > 0,
  ).length;
  recordFilled.value = count;
}

async function handleParseRecordFile(file: File) {
  if (!/\.(png|jpe?g|bmp|webp|pdf|docx?)$/i.test(file.name)) {
    ElMessage.error('请上传图片（png/jpg/jpeg/bmp/webp）、PDF 或 Word 文档');
    return;
  }
  recordParsing.value = true;
  parseFileName.value = file.name;
  try {
    const result = await parseMedicalRecordFile(props.patientId, file);
    const { source, ...fields } = result as MedicalRecordPayload & {
      source: keyof typeof PARSE_SOURCE_LABEL;
    };
    Object.assign(recordForm, fields);
    const filled = Object.values(fields).filter(
      (v) => typeof v === 'string' && v.trim().length > 0,
    ).length;
    lastParse.value = { count: filled, source };
    syncRecordFilled();
    ElMessage.success(
      `AI 已完成${PARSE_SOURCE_LABEL[source] ?? '解析'}，已填入 ${filled} 个字段，请核对后保存`,
    );
  } finally {
    recordParsing.value = false;
  }
}

function openEditPatient() {
  if (!patient.value) return;
  Object.assign(patientForm, {
    age: patient.value.age,
    allergy_history: patient.value.allergy_history ?? '',
    birth_date: patient.value.birth_date ?? null,
    dept: patient.value.dept,
    gender: patient.value.gender || 'male',
    height: patient.value.height ?? undefined,
    name: patient.value.name,
    past_history: patient.value.past_history ?? '',
    phone: patient.value.phone ?? '',
    primary_diag: patient.value.primary_diag,
    status: patient.value.status,
    waistline: patient.value.waistline ?? undefined,
    weight: patient.value.weight ?? undefined,
  });
  patientModalOpen.value = true;
}

async function handlePatientSubmit() {
  await patientFormRef.value?.validate();
  patientSubmitting.value = true;
  try {
    const values: PatientPayload = {
      ...patientForm,
      allergy_history: (patientForm.allergy_history || '').trim() || null,
      birth_date: patientForm.birth_date || null,
      past_history: (patientForm.past_history || '').trim() || null,
    };
    await updatePatient(props.patientId, values);
    ElMessage.success('患者信息已更新');
    patientModalOpen.value = false;
    loadDetail();
  } finally {
    patientSubmitting.value = false;
  }
}

function openCreateRecord() {
  editingRecord.value = null;
  Object.keys(recordForm).forEach((k) => delete (recordForm as Record<string, unknown>)[k]);
  lastParse.value = null;
  parseFileName.value = '';
  recordFilled.value = 0;
  recordModalOpen.value = true;
}

function openEditRecord(record: MedicalRecordItem) {
  editingRecord.value = record;
  Object.keys(recordForm).forEach((k) => delete (recordForm as Record<string, unknown>)[k]);
  for (const f of RECORD_FIELDS) {
    (recordForm as Record<string, string | undefined>)[f.key] =
      (record[f.key] as string | undefined) ?? '';
  }
  syncRecordFilled();
  recordModalOpen.value = true;
}

async function handleRecordSubmit() {
  recordSubmitting.value = true;
  try {
    const values: MedicalRecordPayload = { ...recordForm };
    if (editingRecord.value) {
      await updateMedicalRecord(
        props.patientId,
        editingRecord.value.id,
        values,
      );
      ElMessage.success('病历记录已更新');
    } else {
      const created = await createMedicalRecord(props.patientId, values);
      activeRecordId.value = created.id;
      ElMessage.success('病历记录已创建');
    }
    recordModalOpen.value = false;
    await Promise.all([loadRecords(), loadTimeline()]);
  } finally {
    recordSubmitting.value = false;
  }
}

async function handleDeleteRecord(record: MedicalRecordItem) {
  try {
    await ElMessageBox.confirm('删除后不可恢复，确定继续吗？', '删除病历记录', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    return;
  }
  await deleteMedicalRecord(props.patientId, record.id);
  ElMessage.success('病历记录已删除');
  if (activeRecordId.value === record.id) activeRecordId.value = null;
  await Promise.all([loadRecords(), loadTimeline()]);
}

const bmiPreview = computed(() => calcBMI(patientForm.height, patientForm.weight));

const exportCandidates = computed<ReportCandidate[]>(() =>
  patient.value
    ? [
        {
          id: patient.value.id,
          name: patient.value.name,
          patient_no: patient.value.patient_no,
        },
      ]
    : [],
);

function goBack() {
  emit('back');
  props.onBack();
}

watch(activeRecordId, () => {
  // 切到当前病历，自动落在详情 Tab
  if (activeRecordId.value != null) rightTab.value = 'record';
});
</script>

<template>
  <div class="med-page">
    <PageHead
      :crumbs="[]"
      :title="patient ? `${patient.name} · 病历档案` : '患者详情'"
      :subtitle="
        patient
          ? `${patient.patient_no} · ${deptLabels[patient.dept] ?? patient.dept} · ${GENDER_LABEL[patient.gender] ?? '未知'} · ${patient.age} 岁`
          : '加载中...'
      "
    >
      <template #actions>
        <el-button :icon="ArrowLeft" @click="goBack">返回列表</el-button>
        <el-button
          v-access:code="'patient:update'"
          :icon="Edit"
          @click="openEditPatient"
        >
          编辑资料
        </el-button>
        <el-button
          v-access:code="'patient:export'"
          :icon="Download"
          @click="exportOpen = true"
        >
          导出报告
        </el-button>
        <el-button
          v-access:code="'medical_record:create'"
          type="primary"
          :icon="Plus"
          @click="openCreateRecord"
        >
          新建病历
        </el-button>
      </template>
    </PageHead>

    <el-card v-if="patientLoading && !patient" shadow="never">
      <div class="med-loading"><el-icon class="is-loading"><DataAnalysis /></el-icon></div>
    </el-card>

    <div v-else-if="patient" class="med-detail">
      <div class="med-detail-left">
        <!-- 患者信息卡 -->
        <el-card shadow="never" class="med-info-card">
          <div class="med-info-banner">
            <div class="med-info-id">
              <div
                class="med-avatar med-avatar--lg"
                :class="patient.gender === 'female' ? 'med-avatar--female' : 'med-avatar--male'"
              >
                {{ patient.name?.[0] ?? '?' }}
              </div>
              <div class="med-info-id-meta">
                <div class="med-info-name">{{ patient.name }}</div>
                <div class="med-info-no med-mono">{{ patient.patient_no }}</div>
              </div>
            </div>
            <el-tag
              :type="STATUS_TAG_TYPE[patient.status] ?? 'info'"
              effect="dark"
            >
              {{ statusLabels[patient.status] ?? patient.status }}
            </el-tag>
          </div>
          <el-descriptions :column="2" size="small" class="med-info-desc">
            <el-descriptions-item label="性别">
              {{ GENDER_LABEL[patient.gender] ?? (patient.gender || '未知') }}
            </el-descriptions-item>
            <el-descriptions-item label="年龄">{{ patient.age }} 岁</el-descriptions-item>
            <el-descriptions-item label="身高">
              {{ patient.height ? `${patient.height} cm` : '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="体重">
              {{ patient.weight ? `${patient.weight} kg` : '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="BMI">
              {{ patient.bmi ?? '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="腰围">
              {{ patient.waistline ? `${patient.waistline} cm` : '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="手机号">
              <span class="med-mono">{{ patient.phone || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="科室">
              {{ deptLabels[patient.dept] ?? '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="出生日期">
              <span class="med-mono">{{ patient.birth_date || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="建档时间">
              <span class="med-mono med-text-meta">
                {{ formatTime(patient.created_at) }}
              </span>
            </el-descriptions-item>
          </el-descriptions>
          <el-divider class="med-info-divider" />
          <div class="med-info-label">主诊断</div>
          <div class="med-info-text">{{ patient.primary_diag || '—' }}</div>
          <template v-if="patient.allergy_history || patient.past_history">
            <el-divider class="med-info-divider" />
            <template v-if="patient.allergy_history">
              <div class="med-info-label">过敏史</div>
              <div class="med-info-text">{{ patient.allergy_history }}</div>
            </template>
            <template v-if="patient.past_history">
              <div class="med-info-label" style="margin-top: 10px">既往史</div>
              <div class="med-info-text med-info-text--wrap">
                {{ patient.past_history }}
              </div>
            </template>
          </template>
        </el-card>

        <!-- 病历记录列表 -->
        <el-card shadow="never">
          <template #header>
            <div class="med-record-head">
              <el-icon style="color: var(--el-color-primary)">
                <DocumentIcon />
              </el-icon>
              <span>病历记录</span>
              <span class="med-text-meta">{{ records.length }}</span>
            </div>
          </template>
          <div v-if="recordsLoading" class="med-loading-mini">
            <el-icon class="is-loading"><DataAnalysis /></el-icon>
          </div>
          <el-empty
            v-else-if="!records.length"
            description="暂无病历记录"
            :image-size="80"
          >
            <el-button
              v-access:code="'medical_record:create'"
              type="primary"
              size="small"
              :icon="Plus"
              @click="openCreateRecord"
            >
              新建第一份病历
            </el-button>
          </el-empty>
          <div v-else class="med-record-list">
            <div
              v-for="r in records"
              :key="r.id"
              class="med-record-item"
              :class="{ 'med-record-item--active': r.id === activeRecordId }"
              @click="activeRecordId = r.id"
            >
              <div class="med-record-item-row">
                <span
                  class="med-record-item-title"
                  :class="{ 'med-record-item-title--active': r.id === activeRecordId }"
                >
                  {{ r.chief_complaint || '（无主诉）' }}
                </span>
                <div class="med-record-item-actions" @click.stop>
                  <el-button
                    v-access:code="'medical_record:update'"
                    link
                    type="primary"
                    size="small"
                    :icon="Edit"
                    @click="openEditRecord(r)"
                  />
                  <el-button
                    v-access:code="'medical_record:delete'"
                    link
                    type="danger"
                    size="small"
                    :icon="Delete"
                    @click="handleDeleteRecord(r)"
                  />
                </div>
              </div>
              <div class="med-record-item-time">
                <el-icon><CalendarIcon /></el-icon>
                {{ formatTime(r.created_at) }}
              </div>
            </div>
          </div>
        </el-card>
      </div>

      <div class="med-detail-right">
        <el-tabs v-model="rightTab">
          <el-tab-pane name="record">
            <template #label>
              <span class="med-tab-label">
                <el-icon><DocumentIcon /></el-icon>
                病历详情
              </span>
            </template>
            <el-card v-if="!activeRecord" shadow="never">
              <el-empty description="点击左侧病历记录查看详情" style="padding: 72px 0">
                <el-button
                  v-access:code="'medical_record:create'"
                  type="primary"
                  :icon="Plus"
                  @click="openCreateRecord"
                >
                  新建病历记录
                </el-button>
              </el-empty>
            </el-card>
            <el-card v-else shadow="never">
              <template #header>
                <div class="med-record-detail-head">
                  <el-icon style="color: var(--el-color-primary)">
                    <DocumentIcon />
                  </el-icon>
                  <span>病历详情</span>
                  <span class="med-text-meta">
                    更新于 {{ formatTime(activeRecord.updated_at) }}
                  </span>
                </div>
              </template>
              <RecordAiArchivePanel
                v-access:code="'medical_record:archive'"
                :patient-id="props.patientId"
                :record="activeRecord"
                :events="timeline"
                :on-archived="() => loadRecords()"
              />
              <div style="height: 16px" />
              <template
                v-for="group in RECORD_GROUPS"
                :key="group.title"
              >
                <div class="med-record-group">
                  <div class="med-record-group-title">
                    <span class="med-record-group-bar" />
                    {{ group.title }}
                  </div>
                  <div class="med-record-fields">
                    <div
                      v-for="key in group.keys"
                      :key="key"
                      class="med-record-field"
                      :class="{
                        'med-record-field--span': RECORD_FIELDS.find((f) => f.key === key)?.span === 2,
                      }"
                    >
                      <template
                        v-if="(activeRecord[key] as string | undefined) || ''"
                      >
                        <div class="med-record-field-label">
                          {{ RECORD_FIELDS.find((f) => f.key === key)?.label }}
                        </div>
                        <div class="med-record-field-text">
                          {{ activeRecord[key] }}
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </template>
              <el-text
                v-if="
                  activeRecord
                    && RECORD_GROUPS.every((g) =>
                      g.keys.every((k) => !activeRecord?.[k]),
                    )
                "
                type="info"
              >
                这份病历暂无内容，点击右上角「编辑」补充。
              </el-text>
            </el-card>
          </el-tab-pane>

          <el-tab-pane name="timeline">
            <template #label>
              <span class="med-tab-label">
                <el-icon><CalendarIcon /></el-icon>
                时间线<span v-if="timeline.length">（{{ timeline.length }}）</span>
              </span>
            </template>
            <PatientTimeline
              :events="timeline"
              :loading="timelineLoading"
              :on-open-record="(id) => { activeRecordId = id; rightTab = 'record'; }"
            />
          </el-tab-pane>

          <el-tab-pane name="evolution">
            <template #label>
              <span class="med-tab-label">
                <el-icon><DataAnalysis /></el-icon>
                分析演变
              </span>
            </template>
            <AnalysisEvolution :patient-id="props.patientId" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <el-card v-else shadow="never">
      <el-empty description="患者信息加载失败">
        <el-button @click="goBack">返回列表</el-button>
      </el-empty>
    </el-card>

    <ReportExportModal
      v-model:open="exportOpen"
      :candidates="exportCandidates"
      :default-ids="patient ? [patient.id] : []"
      :lock-selection="true"
    />

    <!-- 编辑患者资料 -->
    <el-dialog
      v-model="patientModalOpen"
      title="编辑患者资料"
      :width="560"
      destroy-on-close
    >
      <el-form
        ref="patientFormRef"
        :model="patientForm"
        :rules="patientRules"
        label-position="top"
        @submit.prevent
      >
        <el-form-item label="姓名" prop="name">
          <el-input v-model="patientForm.name" :maxlength="64" />
        </el-form-item>
        <el-form-item label="性别" prop="gender">
          <el-radio-group v-model="patientForm.gender">
            <el-radio-button value="male">男</el-radio-button>
            <el-radio-button value="female">女</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <div class="med-form-row">
          <el-form-item label="年龄" prop="age">
            <el-input-number
              v-model="patientForm.age"
              :min="0"
              :max="200"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="出生日期" prop="birth_date">
            <el-date-picker
              v-model="patientForm.birth_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选填"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="身高（cm）" prop="height">
            <el-input-number
              v-model="patientForm.height"
              :min="0"
              :max="250"
              :precision="1"
              style="width: 100%"
              placeholder="选填"
            />
          </el-form-item>
        </div>
        <div class="med-form-row">
          <el-form-item label="体重（kg）" prop="weight">
            <el-input-number
              v-model="patientForm.weight"
              :min="0"
              :max="500"
              :precision="1"
              style="width: 100%"
              placeholder="选填"
            />
          </el-form-item>
          <el-form-item label="BMI（自动计算）">
            <el-input
              :model-value="bmiPreview ? String(bmiPreview) : ''"
              placeholder="填身高体重后自动计算"
              disabled
            />
          </el-form-item>
          <el-form-item label="腰围（cm）" prop="waistline">
            <el-input-number
              v-model="patientForm.waistline"
              :min="0"
              :max="300"
              :precision="1"
              style="width: 100%"
              placeholder="选填"
            />
          </el-form-item>
        </div>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="patientForm.phone" :maxlength="32" />
        </el-form-item>
        <el-form-item label="过敏史" prop="allergy_history">
          <el-input
            v-model="patientForm.allergy_history"
            type="textarea"
            :rows="2"
            :maxlength="2000"
          />
        </el-form-item>
        <el-form-item label="既往史" prop="past_history">
          <el-input
            v-model="patientForm.past_history"
            type="textarea"
            :rows="3"
            :maxlength="4000"
          />
        </el-form-item>
        <el-form-item label="主诊断" prop="primary_diag">
          <el-input
            v-model="patientForm.primary_diag"
            type="textarea"
            :rows="2"
            :maxlength="512"
          />
        </el-form-item>
        <el-form-item label="科室" prop="dept">
          <el-select v-model="patientForm.dept" placeholder="请选择科室" style="width: 100%">
            <el-option
              v-for="o in deptOptions"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="patientForm.status" placeholder="请选择状态" style="width: 100%">
            <el-option
              v-for="o in statusOptions"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="patientModalOpen = false">取消</el-button>
        <el-button type="primary" :loading="patientSubmitting" @click="handlePatientSubmit">
          保存修改
        </el-button>
      </template>
    </el-dialog>

    <!-- 新建 / 编辑病历 -->
    <el-dialog
      v-model="recordModalOpen"
      :title="editingRecord ? '编辑病历记录' : '新建病历记录'"
      :width="820"
      destroy-on-close
    >
      <template v-if="!editingRecord">
        <el-upload
          v-access:code="'medical_record:parse'"
          class="med-upload"
          drag
          multiple
          :show-file-list="false"
          :auto-upload="false"
          :on-change="
            (file: { raw?: File }) => file?.raw && handleParseRecordFile(file.raw)
          "
          accept=".png,.jpg,.jpeg,.bmp,.webp,.pdf,.doc,.docx"
        >
          <div class="med-upload-row">
            <div
              class="med-upload-icon"
              :class="
                lastParse
                  ? 'med-upload-icon--success'
                  : 'med-upload-icon--primary'
              "
            >
              <el-icon
                v-if="recordParsing"
                class="is-loading"
                style="font-size: 18px"
              >
                <DataAnalysis />
              </el-icon>
              <el-icon v-else-if="lastParse" style="font-size: 18px">
                <DocumentIcon />
              </el-icon>
              <el-icon v-else style="font-size: 18px">
                <MagicStick />
              </el-icon>
            </div>
            <div class="med-upload-meta">
              <div
                class="med-upload-title"
                :class="
                  lastParse
                    ? 'med-upload-title--success'
                    : 'med-upload-title--primary'
                "
              >
                {{
                  recordParsing
                    ? 'AI 正在识别病历资料…'
                    : lastParse
                      ? '已识别并填入表单'
                      : 'AI 智能导入'
                }}
              </div>
              <div class="med-upload-sub">
                <template v-if="recordParsing">{{ parseFileName }}</template>
                <template
                  v-else-if="lastParse"
                >
                  来源：{{
                    PARSE_SOURCE_LABEL[lastParse.source] ?? lastParse.source
                  }}，已填充 {{ lastParse.count }} 个字段，可核对修改
                </template>
                <template v-else>
                  支持图片识别、PDF、Word 文档，识别后自动填入下方表单
                </template>
              </div>
            </div>
            <span
              class="med-upload-cta"
              :class="
                lastParse
                  ? 'med-upload-cta--success'
                  : 'med-upload-cta--primary'
              "
            >
              {{ recordParsing ? '识别中…' : lastParse ? '重新导入 →' : '上传识别 →' }}
            </span>
          </div>
        </el-upload>
      </template>
      <el-form
        :model="recordForm"
        label-position="top"
        class="med-record-form"
        @submit.prevent
      >
        <div
          v-for="group in RECORD_GROUPS"
          :key="group.title"
          class="med-record-form-group"
        >
          <div class="med-record-form-head">
            <span class="med-record-form-icon">
              <el-icon><component :is="GROUP_ICON_MAP[group.icon]" /></el-icon>
            </span>
            <span class="med-record-form-title">{{ group.title }}</span>
            <span class="med-record-form-desc">{{ group.desc }}</span>
          </div>
          <div class="med-record-form-grid">
            <el-form-item
              v-for="key in group.keys"
              :key="key"
              :label="RECORD_FIELDS.find((f) => f.key === key)?.label"
              :prop="key"
              :class="{
                'med-record-form-item--span':
                  RECORD_FIELDS.find((f) => f.key === key)?.span === 2,
              }"
            >
              <el-input
                v-model="recordForm[key]"
                type="textarea"
                :rows="RECORD_FIELDS.find((f) => f.key === key)?.rows"
                :placeholder="RECORD_FIELDS.find((f) => f.key === key)?.placeholder"
                @input="syncRecordFilled"
              />
            </el-form-item>
          </div>
        </div>
      </el-form>
      <template #footer>
        <div class="med-record-foot">
          <span class="med-text-meta">
            已填写 {{ recordFilled }} / {{ requiredRecordFields.length }} 项
          </span>
          <div>
            <el-button @click="recordModalOpen = false">取消</el-button>
            <el-button
              type="primary"
              :loading="recordSubmitting"
              @click="handleRecordSubmit"
            >
              {{ editingRecord ? '保存修改' : '创建病历' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
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

.med-loading {
  text-align: center;
  padding: 48px;
  color: var(--el-text-color-secondary);
  font-size: 24px;
}

.med-loading-mini {
  text-align: center;
  padding: 24px;
  color: var(--el-text-color-secondary);
}

.med-detail {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.med-detail-left {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 340px;
  flex-shrink: 0;
}

.med-detail-right {
  flex: 1;
  min-width: 0;
}

.med-info-card :deep(.el-card__body) {
  padding: 0;
}

.med-info-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  color: #fff;
  background: linear-gradient(135deg, #1677ff, #722ed1);
}

.med-info-id {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.med-avatar--lg {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  font-size: 18px;
  background: rgb(255 255 255 / 20%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;
}

.med-info-id-meta {
  min-width: 0;
}

.med-info-name {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
}

.med-info-no {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 2px;
}

.med-info-desc {
  padding: 14px 20px 0;
}

.med-info-divider {
  margin: 10px 0;
}

.med-info-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.med-info-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.med-info-text--wrap {
  white-space: pre-wrap;
}

.med-mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}

.med-text-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.med-record-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.med-record-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.med-record-item {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.med-record-item:hover {
  background: var(--el-fill-color-light);
}

.med-record-item--active {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.med-record-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.med-record-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.med-record-item-title--active {
  color: var(--el-color-primary);
  font-weight: 600;
}

.med-record-item-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.med-record-item-time {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  margin-top: 4px;
}

.med-record-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.med-record-group {
  margin-bottom: 18px;
}

.med-record-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-color-primary);
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.med-record-group-bar {
  display: inline-block;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--el-color-primary);
}

.med-record-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.med-record-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.med-record-field--span {
  grid-column: 1 / -1;
}

.med-record-field-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-record-field-text {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.med-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #fff;
  font-weight: 700;
}

.med-avatar--male {
  background: linear-gradient(135deg, #1677ff, #722ed1);
}

.med-avatar--female {
  background: linear-gradient(135deg, #eb2f96, #c084fc);
}

.med-form-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.med-record-form {
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 6px;
}

.med-record-form-group {
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  padding: 14px 16px 8px;
  margin-bottom: 14px;
}

.med-record-form-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.med-record-form-icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}

.med-record-form-title {
  font-weight: 600;
  font-size: 13.5px;
}

.med-record-form-desc {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-record-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 16px;
}

.med-record-form-item--span {
  grid-column: 1 / -1;
}

.med-record-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.med-record-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.med-upload :deep(.el-upload) {
  width: 100%;
}

.med-upload :deep(.el-upload-dragger) {
  margin-bottom: 16px;
  padding: 10px 12px;
  border-radius: 10px;
  border-style: dashed;
  transition:
    background 0.2s,
    border-color 0.2s;
}

.med-upload :deep(.el-upload-dragger) {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-5);
}

.med-upload--success :deep(.el-upload-dragger) {
  background: #f6ffed;
  border-color: #b7eb8f;
}

.med-upload-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.med-upload-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.med-upload-icon--primary {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-8);
}

.med-upload-icon--success {
  color: var(--el-color-success);
  background: #d9f1e3;
}

.med-upload-meta {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.med-upload-title {
  font-size: 13.5px;
  font-weight: 600;
}

.med-upload-title--primary {
  color: var(--el-color-primary);
}

.med-upload-title--success {
  color: var(--el-color-success);
}

.med-upload-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.med-upload-cta {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.med-upload-cta--primary {
  color: var(--el-color-primary);
}

.med-upload-cta--success {
  color: var(--el-color-success);
}

@media (width <= 1100px) {
  .med-detail {
    flex-direction: column;
  }
  .med-detail-left {
    width: 100%;
  }
}
</style>
