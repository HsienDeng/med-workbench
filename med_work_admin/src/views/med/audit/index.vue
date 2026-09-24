<script lang="ts" setup>
/**
 * 审计日志（迁移自 med-work-frontend Audit）：
 * 只读表格 + 筛选（关键词 / 模块 / 操作 / 结果 / 日期范围），选项来自 /audit/options。
 */
import { onMounted, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';
import { Refresh, Search } from '@element-plus/icons-vue';
import dayjs from 'dayjs';

import PageHead from '#/components/med/page-head.vue';
import { getAuditLogs, getAuditOptions } from '#/api/med/audit';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_MODULE_LABELS,
  AUDIT_RESULT_LABELS,
  type AuditLogItem,
} from '#/types/med';

const MODULE_TYPE: Record<string, 'danger' | 'info' | 'primary' | 'success' | 'warning'> = {
  analysis: 'warning',
  auth: 'primary',
  medical_record: 'success',
  patient: 'info',
};

const ACTION_TYPE: Record<string, 'danger' | 'info' | 'primary' | 'success' | 'warning'> = {
  create: 'success',
  delete: 'danger',
  login: 'primary',
  parse: 'warning',
  update: 'warning',
  view: 'info',
};

const RESULT_TYPE: Record<string, 'danger' | 'info' | 'success' | 'warning'> = {
  denied: 'warning',
  failure: 'danger',
  success: 'success',
};

const RESOURCE_LABELS: Record<string, string> = {
  analysis_record: '分析记录',
  medical_record: '病历记录',
  patient: '患者档案',
};

const rows = ref<AuditLogItem[]>([]);
const loading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const keyword = ref('');
const moduleCode = ref('');
const actionCode = ref('');
const resultCode = ref('');
const range = ref<[string, string] | null>(null);

const modules = ref<string[]>(Object.keys(AUDIT_MODULE_LABELS));
const actions = ref<string[]>(Object.keys(AUDIT_ACTION_LABELS));

async function loadOptions() {
  try {
    const res = await getAuditOptions();
    if (res.modules?.length) modules.value = res.modules;
    if (res.actions?.length) actions.value = res.actions;
  } catch {
    /* 回退本地常量 */
  }
}

async function load() {
  loading.value = true;
  try {
    const res = await getAuditLogs({
      action: actionCode.value || undefined,
      end_date: range.value?.[1],
      keyword: keyword.value.trim() || undefined,
      module: moduleCode.value || undefined,
      page: page.value,
      page_size: pageSize.value,
      result: resultCode.value || undefined,
      start_date: range.value?.[0],
    });
    rows.value = res.items ?? [];
    total.value = res.total ?? 0;
  } catch {
    ElMessage.error('加载审计日志失败');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadOptions();
  await load();
});

watch([page, pageSize, moduleCode, actionCode, resultCode, range], () => {
  void load();
});

function resetFilters() {
  keyword.value = '';
  moduleCode.value = '';
  actionCode.value = '';
  resultCode.value = '';
  range.value = null;
  page.value = 1;
  void load();
}

function fmtTime(value?: null | string) {
  return value ? value.replace('T', ' ').slice(0, 19) : '—';
}

/** 日期范围选择后转成 YYYY-MM-DD 数组 */
function handleRangeChange(value: null | string[]) {
  if (!value || value.length !== 2) {
    range.value = null;
    return;
  }
  range.value = [
    dayjs(value[0]!).format('YYYY-MM-DD'),
    dayjs(value[1]!).format('YYYY-MM-DD'),
  ];
}

function resourceText(row: AuditLogItem) {
  if (!row.resource_type && !row.resource_id) return '—';
  if (row.resource_id) {
    const label = RESOURCE_LABELS[row.resource_type ?? ''] ?? row.resource_type ?? '';
    return `${label} ${row.resource_id}`.trim();
  }
  return row.resource_type ?? '—';
}
</script>

<template>
  <div class="med-page">
    <div class="med-page-inner">
      <PageHead
        :crumbs="[{ label: '系统管理' }, { label: '审计日志', current: true }]"
        title="审计日志"
        subtitle="记录登录、患者档案 / 病历 / AI 分析等关键操作的完整轨迹（仅管理员与审计员可见）"
      />

      <el-card shadow="never">
        <div class="audit-filters">
          <el-input
            v-model="keyword"
            clearable
            placeholder="搜索账号 / 姓名 / 摘要"
            class="audit-search"
            :prefix-icon="Search"
            @keyup.enter="page = 1; load()"
          />
          <el-select
            v-model="moduleCode"
            clearable
            placeholder="全部模块"
            class="audit-select"
            @change="page = 1"
          >
            <el-option
              v-for="m in modules"
              :key="m"
              :label="AUDIT_MODULE_LABELS[m] ?? m"
              :value="m"
            />
          </el-select>
          <el-select
            v-model="actionCode"
            clearable
            placeholder="全部操作"
            class="audit-select"
            @change="page = 1"
          >
            <el-option
              v-for="a in actions"
              :key="a"
              :label="AUDIT_ACTION_LABELS[a] ?? a"
              :value="a"
            />
          </el-select>
          <el-select
            v-model="resultCode"
            clearable
            placeholder="全部结果"
            class="audit-select audit-select--sm"
            @change="page = 1"
          >
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failure" />
            <el-option label="拒绝" value="denied" />
          </el-select>
          <el-date-picker
            :model-value="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="(v: null | string[]) => handleRangeChange(v)"
          />
          <el-button text @click="resetFilters">重置</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <span class="audit-total">共 {{ total }} 条记录</span>
        </div>

        <el-table v-loading="loading" :data="rows" row-key="id" border stripe>
          <el-table-column label="时间" prop="created_at" width="170">
            <template #default="{ row }">
              <span class="audit-mono">{{ fmtTime(row.created_at) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作者" width="150">
            <template #default="{ row }">
              <div class="audit-actor">
                <span class="audit-actor-name">{{ row.real_name || row.username || '—' }}</span>
                <span
                  v-if="row.username && row.username !== row.real_name"
                  class="audit-sub"
                >
                  @{{ row.username }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="模块" prop="module" width="110">
            <template #default="{ row }">
              <el-tag :type="MODULE_TYPE[row.module] ?? 'info'" size="small">
                {{ AUDIT_MODULE_LABELS[row.module] ?? row.module }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" prop="action" width="100">
            <template #default="{ row }">
              <el-tag :type="ACTION_TYPE[row.action] ?? 'info'" size="small">
                {{ AUDIT_ACTION_LABELS[row.action] ?? row.action }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="资源" width="170">
            <template #default="{ row }">
              <span class="audit-mono">{{ resourceText(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="摘要" prop="detail" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ row.detail || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="结果" prop="result" width="90">
            <template #default="{ row }">
              <el-tag :type="RESULT_TYPE[row.result] ?? 'info'" size="small">
                {{ AUDIT_RESULT_LABELS[row.result] ?? row.result }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源 IP" prop="ip" width="140">
            <template #default="{ row }">
              <span class="audit-mono">{{ row.ip || '—' }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无符合条件的审计记录" :image-size="60" />
          </template>
        </el-table>

        <div class="audit-pager">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="total"
            layout="total, sizes, prev, pager, next"
            background
          />
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.med-page {
  height: 100%;
  padding: 20px;
  overflow-y: auto;
}

.med-page-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.audit-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.audit-search {
  width: 240px;
}

.audit-select {
  width: 140px;
}

.audit-select--sm {
  width: 120px;
}

.audit-total {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.audit-mono {
  font-family: var(--el-font-family-monospace, Consolas, monospace);
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.audit-actor {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.audit-actor-name {
  font-size: 13px;
  font-weight: 600;
}

.audit-sub {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.audit-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
