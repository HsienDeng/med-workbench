<script lang="ts" setup>
/**
 * 患者档案列表页（迁移自 med-work-frontend Patients）。
 * 分页列表 + 关键词 / 科室 / 状态筛选 + 勾选导出报告 + 新建/编辑模态。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Delete,
  Download,
  Edit,
  Plus,
  Search,
  View,
} from '@element-plus/icons-vue';

import PageHead from '#/components/med/page-head.vue';
import ReportExportModal, {
  type ReportCandidate,
} from '#/components/med/report-export-modal.vue';
import {
  createPatient,
  deletePatient,
  getPatients,
  updatePatient,
} from '#/api/med/patients';
import type {
  PatientItem,
  PatientListQuery,
  PatientPayload,
} from '#/types/med';
import {
  DICT_DEPT,
  DICT_PATIENT_STATUS,
  FALLBACK_DEPT_OPTIONS,
  FALLBACK_PATIENT_STATUS_OPTIONS,
} from '#/constants/med/dictionary';
import { useDictionaryOptions } from '#/hooks/use-dictionary-options';

/** 患者状态 → Tag 类型（Element Plus 内置） */
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

// ---------- 字典 ----------
const { options: deptOptions, labels: deptLabels } = useDictionaryOptions(
  DICT_DEPT,
  FALLBACK_DEPT_OPTIONS,
);
const { options: statusOptions, labels: statusLabels } = useDictionaryOptions(
  DICT_PATIENT_STATUS,
  FALLBACK_PATIENT_STATUS_OPTIONS,
);

// ---------- 列表状态 ----------
const loading = ref(false);
const rows = ref<PatientItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const keyword = ref('');
const dept = ref('');
const status = ref('');
const selectedIds = ref<number[]>([]);

// ---------- 新建 / 编辑 ----------
const modalOpen = ref(false);
const editing = ref<null | PatientItem>(null);
const submitting = ref(false);
const formRef = ref();

const form = reactive<
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

const requiredRules = {
  age: [{ message: '请输入年龄', required: true }],
  birth_date: [],
  dept: [{ message: '请选择科室', required: true }],
  gender: [{ message: '请选择性别', required: true }],
  name: [{ message: '请输入姓名', required: true }],
  primary_diag: [{ message: '请输入主诊断', required: true }],
  status: [{ message: '请选择状态', required: true }],
};

// ---------- 详情整页 ----------
const detailId = ref<null | number>(null);

// ---------- 报告导出 ----------
const exportOpen = ref(false);

async function load() {
  loading.value = true;
  try {
    const query: PatientListQuery = {
      dept: dept.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      page_size: pageSize.value,
      status: status.value || undefined,
    };
    const res = await getPatients(query);
    rows.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

watch([keyword, dept, status], () => {
  page.value = 1;
  load();
});

const bmiPreview = computed(() => calcBMI(form.height, form.weight));

const exportCandidates = computed<ReportCandidate[]>(() =>
  rows.value
    .filter((r) => selectedIds.value.includes(r.id))
    .map((r) => ({ id: r.id, name: r.name, patient_no: r.patient_no })),
);

function openCreate() {
  editing.value = null;
  Object.assign(form, {
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
  modalOpen.value = true;
}

function openEdit(item: PatientItem) {
  editing.value = item;
  Object.assign(form, {
    age: item.age,
    allergy_history: item.allergy_history ?? '',
    birth_date: item.birth_date ?? null,
    dept: item.dept,
    gender: item.gender || 'male',
    height: item.height ?? undefined,
    name: item.name,
    past_history: item.past_history ?? '',
    phone: item.phone ?? '',
    primary_diag: item.primary_diag,
    status: item.status,
    waistline: item.waistline ?? undefined,
    weight: item.weight ?? undefined,
  });
  modalOpen.value = true;
}

async function handleSubmit() {
  await formRef.value?.validate();
  submitting.value = true;
  try {
    const values: PatientPayload = {
      ...form,
      allergy_history: (form.allergy_history || '').trim() || null,
      birth_date: form.birth_date || null,
      past_history: (form.past_history || '').trim() || null,
    };
    if (editing.value) {
      await updatePatient(editing.value.id, values);
      ElMessage.success('患者信息已更新');
    } else {
      await createPatient(values);
      ElMessage.success('患者档案已创建');
    }
    modalOpen.value = false;
    load();
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(item: PatientItem) {
  await ElMessageBox.confirm(
    `确定删除「${item.name}」吗？删除后不可恢复。`,
    '删除患者档案',
    { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
  );
  await deletePatient(item.id);
  ElMessage.success('已删除');
  load();
}

function onSelectionChange(ids: number[]) {
  selectedIds.value = ids;
}

function openExport() {
  if (!selectedIds.value.length) {
    ElMessage.info('请先勾选要导出报告的患者');
    return;
  }
  exportOpen.value = true;
}
</script>

<template>
  <div class="med-page">
    <PageHead
      :crumbs="[]"
      title="患者档案"
      subtitle="患者基本资料与病例分析归属管理"
    >
      <template #actions>
        <el-button
          v-access:code="'patient:export'"
          :icon="Download"
          @click="openExport"
        >
          导出报告<span v-if="selectedIds.length">（{{ selectedIds.length }}）</span>
        </el-button>
        <el-button
          v-access:code="'patient:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate"
        >
          新建患者
        </el-button>
      </template>
    </PageHead>

    <el-card shadow="never" class="med-list-card">
      <div class="med-list-toolbar">
        <el-input
          v-model="keyword"
          :prefix-icon="Search"
          placeholder="搜索姓名 / 手机号 / 主诊断"
          clearable
          class="med-list-search"
        />
        <el-select
          v-model="dept"
          placeholder="全部科室"
          clearable
          class="med-list-dept"
        >
          <el-option
            v-for="o in deptOptions"
            :key="o.value"
            :label="o.label"
            :value="o.value"
          />
        </el-select>
        <el-select
          v-model="status"
          placeholder="全部状态"
          clearable
          class="med-list-status"
        >
          <el-option
            v-for="o in statusOptions"
            :key="o.value"
            :label="o.label"
            :value="o.value"
          />
        </el-select>
      </div>

      <el-table
        v-loading="loading"
        :data="rows"
        row-key="id"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="44" />
        <el-table-column label="患者编号" width="170">
          <template #default="{ row }">
            <span class="med-mono med-primary">{{ row.patient_no }}</span>
          </template>
        </el-table-column>
        <el-table-column label="患者" width="200">
          <template #default="{ row }">
            <div class="med-patient-cell">
              <div
                class="med-avatar"
                :class="row.gender === 'female' ? 'med-avatar--female' : 'med-avatar--male'"
              >
                {{ row.name?.[0] ?? '?' }}
              </div>
              <div class="med-patient-meta">
                <div class="med-patient-name">{{ row.name }}</div>
                <div class="med-patient-sub">
                  {{ GENDER_LABEL[row.gender] ?? (row.gender || '未知') }} · {{ row.age }} 岁
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="科室" width="130">
          <template #default="{ row }">
            <span>{{ deptLabels[row.dept] ?? '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="主诊断" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.primary_diag || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG_TYPE[row.status] ?? 'info'" effect="light">
              {{ statusLabels[row.status] ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            <span class="med-mono med-text-meta">{{ formatTime(row.created_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="right" fixed="right">
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
            <el-button
              v-access:code="'patient:update'"
              link
              type="primary"
              :icon="Edit"
              size="small"
              @click="openEdit(row)"
            >
              编辑
            </el-button>
            <el-button
              v-access:code="'patient:delete'"
              link
              type="danger"
              :icon="Delete"
              size="small"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="med-list-pagination">
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
          <template #total>共 {{ total }} 位患者</template>
        </el-pagination>
      </div>
    </el-card>

    <ReportExportModal
      v-model:open="exportOpen"
      :candidates="exportCandidates"
      :default-ids="selectedIds"
    />

    <PatientDetailView
      v-if="detailId != null"
      :patient-id="detailId"
      @back="detailId = null"
    />

    <el-dialog
      v-model="modalOpen"
      :title="editing ? '编辑患者' : '新建患者'"
      :width="560"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="requiredRules"
        label-position="top"
        @submit.prevent
      >
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" placeholder="请输入患者姓名" :maxlength="64" />
        </el-form-item>
        <el-form-item label="性别" prop="gender">
          <el-radio-group v-model="form.gender">
            <el-radio-button value="male">男</el-radio-button>
            <el-radio-button value="female">女</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <div class="med-form-row">
          <el-form-item label="年龄" prop="age">
            <el-input-number
              v-model="form.age"
              :min="0"
              :max="200"
              style="width: 100%"
              placeholder="岁"
            />
          </el-form-item>
          <el-form-item label="出生日期" prop="birth_date">
            <el-date-picker
              v-model="form.birth_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选填"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="身高（cm）" prop="height">
            <el-input-number
              v-model="form.height"
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
              v-model="form.weight"
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
              v-model="form.waistline"
              :min="0"
              :max="300"
              :precision="1"
              style="width: 100%"
              placeholder="选填"
            />
          </el-form-item>
        </div>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" placeholder="选填" :maxlength="32" />
        </el-form-item>
        <el-form-item label="过敏史" prop="allergy_history">
          <el-input
            v-model="form.allergy_history"
            type="textarea"
            :rows="2"
            placeholder="档案层常驻过敏史，选填（与单次病历的过敏史区分）"
            :maxlength="2000"
          />
        </el-form-item>
        <el-form-item label="既往史" prop="past_history">
          <el-input
            v-model="form.past_history"
            type="textarea"
            :rows="3"
            placeholder="既往高血压 / 糖尿病 / 手术史等，选填（常驻档案）"
            :maxlength="4000"
          />
        </el-form-item>
        <el-form-item label="主诊断" prop="primary_diag">
          <el-input
            v-model="form.primary_diag"
            type="textarea"
            :rows="2"
            placeholder="请输入主诊断"
            :maxlength="512"
          />
        </el-form-item>
        <el-form-item label="科室" prop="dept">
          <el-select v-model="form.dept" placeholder="请选择科室" style="width: 100%">
            <el-option
              v-for="o in deptOptions"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" placeholder="请选择状态" style="width: 100%">
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
        <el-button @click="modalOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ editing ? '保存修改' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
// 详情子页（与列表互斥显示：detailId 切换时立即卸载/挂载）
import PatientDetailView from './patient-detail-view.vue';
export default { components: { PatientDetailView } };
</script>

<style scoped>
.med-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  padding: 16px;
  overflow-y: auto;
}

.med-list-card :deep(.el-card__body) {
  padding: 0;
}

.med-list-toolbar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.med-list-search {
  width: 260px;
  max-width: 100%;
}

.med-list-dept {
  width: 150px;
}

.med-list-status {
  width: 130px;
}

.med-list-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
}

.med-mono {
  font-family: var(--el-font-family-monospace, 'SFMono-Regular', Consolas, monospace);
}

.med-primary {
  color: var(--el-color-primary);
  font-weight: 600;
}

.med-text-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-patient-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.med-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}

.med-avatar--male {
  background: linear-gradient(135deg, #1677ff, #722ed1);
}

.med-avatar--female {
  background: linear-gradient(135deg, #eb2f96, #c084fc);
}

.med-patient-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.med-patient-name {
  font-weight: 600;
  font-size: 13px;
}

.med-patient-sub {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.med-form-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (width <= 768px) {
  .med-form-row {
    grid-template-columns: 1fr;
  }
}
</style>
