<script lang="ts" setup>
/**
 * 账号管理（迁移自 med-work-frontend Accounts）：
 * 列表（关键词/状态/角色/科室筛选 + 分页）+ 新建抽屉（返回一次性初始密码）
 * + 编辑抽屉（角色分配）+ 状态流转（启用/停用/锁定→解锁/待启用）+ 重置密码
 * + 批量文本导入 + 删除；维护操作按 `organization:user:manage` 控制。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';

import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import {
  Delete,
  Edit,
  Key,
  Plus,
  Refresh,
  Unlock,
  Upload,
} from '@element-plus/icons-vue';

import PageHead from '#/components/med/page-head.vue';
import {
  batchImportAccounts,
  createAccount,
  deleteAccount,
  getAccountOptions,
  getAccounts,
  resetAccountPassword,
  setAccountStatus,
  updateAccount,
} from '#/api/med/accounts';
import type {
  AccountBatchImportResult,
  AccountGender,
  AccountItem,
  AccountOptions,
  AccountStatus,
} from '#/types/med';
import { useAccessStore, useUserStore } from '@vben/stores';

// ==================== 权限 / 当前用户 ====================

const accessStore = useAccessStore();
const userStore = useUserStore();
const canManage = computed(() =>
  accessStore.accessCodes?.includes('organization:user:manage'),
);
const currentUserId = computed(() => Number(userStore.userInfo?.userId ?? 0));

const STATUS_META: Record<AccountStatus, { label: string; type: 'danger' | 'info' | 'success' | 'warning' }> = {
  active: { label: '启用', type: 'success' },
  disabled: { label: '已停用', type: 'info' },
  locked: { label: '已锁定', type: 'danger' },
  pending: { label: '待启用', type: 'warning' },
};

const GENDER_OPTIONS: Array<{ label: string; value: AccountGender }> = [
  { label: '男', value: 'male' },
  { label: '女', value: 'female' },
  { label: '未填写', value: 'unknown' },
];

const GENDER_LABEL: Record<string, string> = {
  female: '女',
  male: '男',
};

const ROLE_TYPE: Record<string, 'danger' | 'info' | 'primary' | 'success' | 'warning'> = {
  auditor: 'warning',
  doctor: 'primary',
  hospital_admin: 'danger',
  knowledge_admin: 'success',
};

const ROLE_ORDER = ['hospital_admin', 'doctor', 'knowledge_admin', 'auditor'];

// ==================== 列表 ====================

const rows = ref<AccountItem[]>([]);
const loading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const searchText = ref('');
const filterStatus = ref<AccountStatus | ''>('');
const filterRole = ref('');
const filterDept = ref<number | undefined>(undefined);

const options = ref<AccountOptions>({ departments: [], roles: [] });
const optionsLoading = ref(false);

async function loadOptions() {
  optionsLoading.value = true;
  try {
    options.value = await getAccountOptions();
  } catch {
    /* request 层已提示 */
  } finally {
    optionsLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const res = await getAccounts({
      department_id: filterDept.value,
      keyword: searchText.value.trim() || undefined,
      page: page.value,
      page_size: pageSize.value,
      role_code: filterRole.value || undefined,
      status: filterStatus.value || undefined,
    });
    rows.value = res.items ?? [];
    total.value = res.total ?? 0;
  } catch {
    /* request 层已提示 */
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadOptions();
  await load();
});

watch([page, pageSize, filterStatus, filterRole, filterDept], () => {
  void load();
});

function resetFilters() {
  searchText.value = '';
  filterStatus.value = '';
  filterRole.value = '';
  filterDept.value = undefined;
  page.value = 1;
  void load();
}

function fmtTime(value?: null | string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—';
}

function sortedRoles(item: AccountItem) {
  return [...item.roles].sort(
    (a, b) =>
      (ROLE_ORDER.indexOf(a.role_code) < 0 ? 9 : ROLE_ORDER.indexOf(a.role_code)) -
      (ROLE_ORDER.indexOf(b.role_code) < 0 ? 9 : ROLE_ORDER.indexOf(b.role_code)),
  );
}

function isSelf(item: AccountItem) {
  return item.id === currentUserId.value;
}

// ==================== 新建 / 编辑抽屉 ====================

const drawerOpen = ref(false);
const drawerMode = ref<'create' | 'edit'>('create');
const editing = ref<null | AccountItem>(null);
const submitting = ref(false);
const formRef = ref<FormInstance>();

const form = reactive({
  department_id: undefined as number | undefined,
  employee_no: '',
  gender: 'unknown' as AccountGender,
  password: '',
  professional_title: '',
  real_name: '',
  role_ids: [] as number[],
  status: 'active' as AccountStatus,
  username: '',
});

const rules: FormRules = {
  real_name: [{ message: '请输入真实姓名', required: true, trigger: 'blur' }],
  role_ids: [
    {
      message: '请至少选择一个角色',
      required: true,
      trigger: 'change',
      validator: (_r, value: number[]) => (value?.length ?? 0) > 0,
    },
  ],
  username: [
    { message: '请输入登录账号', required: true, trigger: 'blur' },
    {
      message: '仅支持字母、数字、下划线、点与短横线',
      pattern: /^[A-Za-z0-9_.\-]+$/,
      trigger: 'blur',
    },
    { max: 64, message: '最长 64 个字符', trigger: 'blur' },
    { min: 2, message: '至少 2 个字符', trigger: 'blur' },
  ],
};

const isCreate = computed(() => drawerMode.value === 'create');

/** 编辑自己时，管理员角色不可移除 */
function roleDisabled(roleCode: string) {
  return !isCreate.value && editing.value?.id === currentUserId.value && roleCode === 'hospital_admin';
}

function openCreate() {
  drawerMode.value = 'create';
  editing.value = null;
  Object.assign(form, {
    department_id: undefined,
    employee_no: '',
    gender: 'unknown',
    password: '',
    professional_title: '',
    real_name: '',
    role_ids: [],
    status: 'active',
    username: '',
  });
  drawerOpen.value = true;
}

function openEdit(item: AccountItem) {
  drawerMode.value = 'edit';
  editing.value = item;
  Object.assign(form, {
    department_id: item.primary_department_id ?? undefined,
    employee_no: item.employee_no ?? '',
    gender: item.gender ?? 'unknown',
    professional_title: item.professional_title ?? '',
    real_name: item.real_name,
    role_ids: item.roles.map((r) => r.id),
  });
  drawerOpen.value = true;
}

async function submit() {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    if (isCreate.value) {
      const res = await createAccount({
        department_id: form.department_id ?? null,
        employee_no: form.employee_no.trim() || null,
        gender: form.gender,
        password: form.password.trim() || null,
        professional_title: form.professional_title.trim() || null,
        real_name: form.real_name.trim(),
        role_ids: form.role_ids,
        status: form.status,
        username: form.username.trim(),
      });
      ElMessage.success(`账号「${res.real_name}」已创建`);
      if (res.password) {
        createdAccount.value = { password: res.password, username: res.username };
      }
    } else if (editing.value) {
      await updateAccount(editing.value.id, {
        department_id: form.department_id ?? null,
        employee_no: form.employee_no.trim() || null,
        gender: form.gender,
        professional_title: form.professional_title.trim() || null,
        real_name: form.real_name.trim(),
        role_ids: form.role_ids,
      });
      ElMessage.success('账号信息已更新');
    }
    drawerOpen.value = false;
    await load();
  } catch {
    /* request 层已提示 */
  } finally {
    submitting.value = false;
  }
}

// ==================== 创建成功：一次性密码 ====================

const createdAccount = ref<null | { password: string; username: string }>(null);

// ==================== 状态操作 ====================

async function changeStatus(item: AccountItem, status: AccountStatus, text: string) {
  try {
    await setAccountStatus(item.id, status);
    ElMessage.success(`${item.real_name} 已${text}`);
    await load();
  } catch {
    /* request 层已提示 */
  }
}

async function handleDisable(item: AccountItem) {
  try {
    await ElMessageBox.confirm(
      '停用后该账号将立即无法登录，且其登录会话会失效。',
      `停用账号「${item.real_name}」？`,
      { type: 'warning' },
    );
  } catch {
    return;
  }
  await changeStatus(item, 'disabled', '停用');
}

async function handleDelete(item: AccountItem) {
  try {
    await ElMessageBox.confirm(
      '删除后该账号将无法登录，其会话即时失效；操作不可恢复。',
      `删除账号「${item.real_name}」？`,
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await deleteAccount(item.id);
    ElMessage.success(`账号「${item.username}」已删除`);
    if (rows.value.length === 1 && page.value > 1) page.value -= 1;
    else await load();
  } catch {
    /* request 层已提示 */
  }
}

// ==================== 重置密码 ====================

const resetTarget = ref<null | AccountItem>(null);
const resetOpen = ref(false);
const resetDraft = ref('');
const resetDone = ref<null | string>(null);
const resetSubmitting = ref(false);

function openReset(item: AccountItem) {
  resetTarget.value = item;
  resetDraft.value = '';
  resetDone.value = null;
  resetOpen.value = true;
}

async function handleReset(generate: boolean) {
  if (!resetTarget.value) return;
  if (!generate && !resetDraft.value.trim()) {
    ElMessage.warning('请输入新密码，或点击「自动生成」');
    return;
  }
  resetSubmitting.value = true;
  try {
    const res = await resetAccountPassword(
      resetTarget.value.id,
      generate ? null : resetDraft.value.trim(),
    );
    resetDone.value = res.password;
    ElMessage.success(`已重置 ${resetTarget.value.real_name} 的密码，请妥善保存`);
    await load();
  } catch {
    /* request 层已提示 */
  } finally {
    resetSubmitting.value = false;
  }
}

// ==================== 批量导入 ====================

const importOpen = ref(false);
const importText = ref('');
const importing = ref(false);
const importResult = ref<null | AccountBatchImportResult>(null);

function openImport() {
  importText.value = '';
  importResult.value = null;
  importOpen.value = true;
}

async function handleImport() {
  if (!importText.value.trim()) return;
  importing.value = true;
  try {
    importResult.value = await batchImportAccounts(importText.value);
    ElMessage.success(`成功创建 ${importResult.value.created} 个账号`);
    await load();
  } catch {
    /* request 层已提示 */
  } finally {
    importing.value = false;
  }
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(`${label}已复制`);
  } catch {
    ElMessage.error('复制失败，请手动选择复制');
  }
}
</script>

<template>
  <div class="med-page">
    <div class="med-page-inner">
      <PageHead
        :crumbs="[{ label: '系统管理' }, { label: '账号管理', current: true }]"
        title="账号管理"
        subtitle="管理院内平台登录账号，配置科室归属与角色授权，支持启用停用、锁定解锁与密码重置"
      >
        <template #actions>
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <template v-if="canManage">
            <el-button :icon="Upload" @click="openImport">批量导入</el-button>
            <el-button type="primary" :icon="Plus" @click="openCreate">新建账号</el-button>
          </template>
        </template>
      </PageHead>

      <!-- 筛选 -->
      <el-card shadow="never">
        <div class="acct-filters">
          <el-input
            v-model="searchText"
            clearable
            placeholder="搜索账号 / 姓名 / 工号"
            class="acct-search"
            @keyup.enter="page = 1; load()"
          />
          <el-select v-model="filterStatus" clearable placeholder="全部状态" class="acct-select">
            <el-option
              v-for="(meta, key) in STATUS_META"
              :key="key"
              :label="meta.label"
              :value="key"
            />
          </el-select>
          <el-select
            v-model="filterRole"
            clearable
            placeholder="全部角色"
            class="acct-select"
            :loading="optionsLoading"
          >
            <el-option
              v-for="r in options.roles"
              :key="r.role_code"
              :label="r.role_name"
              :value="r.role_code"
            />
          </el-select>
          <el-select
            v-model="filterDept"
            clearable
            filterable
            placeholder="全部科室"
            class="acct-select"
            :loading="optionsLoading"
          >
            <el-option
              v-for="d in options.departments"
              :key="d.id"
              :label="d.department_name"
              :value="d.id"
            />
          </el-select>
          <el-button text @click="resetFilters">重置</el-button>
          <span class="acct-total">共 {{ total }} 个账号</span>
        </div>
      </el-card>

      <!-- 列表 -->
      <el-card shadow="never">
        <el-table v-loading="loading" :data="rows" row-key="id" border stripe>
          <el-table-column label="登录账号" prop="username" min-width="170">
            <template #default="{ row }">
              <div class="acct-username">
                <span class="acct-mono">{{ row.username }}</span>
                <el-tag v-if="isSelf(row)" type="warning" size="small">我</el-tag>
                <el-tag v-if="row.must_change_password" type="warning" size="small" effect="plain">
                  待改密
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="姓名" prop="real_name" min-width="150">
            <template #default="{ row }">
              <div class="acct-name">
                <span>{{ row.real_name }}</span>
                <span v-if="row.gender && row.gender !== 'unknown'" class="acct-sub">
                  {{ GENDER_LABEL[row.gender] }}
                </span>
                <span v-if="row.professional_title" class="acct-sub acct-sub--block">
                  {{ row.professional_title }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="工号" prop="employee_no" width="110">
            <template #default="{ row }">{{ row.employee_no || '—' }}</template>
          </el-table-column>
          <el-table-column label="所属科室" prop="department_name" min-width="130">
            <template #default="{ row }">{{ row.department_name || '—' }}</template>
          </el-table-column>
          <el-table-column label="角色" min-width="180">
            <template #default="{ row }">
              <div class="acct-roles">
                <template v-if="!sortedRoles(row).length">
                  <span class="acct-sub">无</span>
                </template>
                <template v-else>
                  <el-tag
                    v-for="role in sortedRoles(row).slice(0, 2)"
                    :key="role.id"
                    :type="ROLE_TYPE[role.role_code] ?? 'info'"
                    size="small"
                  >
                    {{ role.role_name }}
                  </el-tag>
                  <el-tooltip
                    v-if="sortedRoles(row).length > 2"
                    :content="sortedRoles(row).slice(2).map((r: { role_name: string }) => r.role_name).join('、')"
                    placement="top"
                  >
                    <el-tag type="info" size="small">
                      +{{ sortedRoles(row).length - 2 }}
                    </el-tag>
                  </el-tooltip>
                </template>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" prop="status" width="100">
            <template #default="{ row }">
              <el-tag :type="STATUS_META[row.status as AccountStatus].type" size="small">
                {{ STATUS_META[row.status as AccountStatus].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最近登录" prop="last_login_at" width="150">
            <template #default="{ row }">
              <span class="acct-sub">{{ fmtTime(row.last_login_at) }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="canManage" fixed="right" label="操作" width="230">
            <template #default="{ row }">
              <el-button link type="primary" size="small" :icon="Edit" @click="openEdit(row)">
                编辑
              </el-button>
              <el-button
                link
                type="primary"
                size="small"
                :icon="Key"
                :disabled="row.status === 'disabled'"
                @click="openReset(row)"
              >
                重置密码
              </el-button>
              <template v-if="row.status === 'active'">
                <el-button
                  link
                  type="danger"
                  size="small"
                  :disabled="isSelf(row)"
                  @click="handleDisable(row)"
                >
                  停用
                </el-button>
              </template>
              <el-button
                v-else-if="row.status === 'locked'"
                link
                type="primary"
                size="small"
                :icon="Unlock"
                @click="changeStatus(row, 'active', '解锁')"
              >
                解锁
              </el-button>
              <el-button
                v-else
                link
                type="primary"
                size="small"
                :icon="Unlock"
                @click="changeStatus(row, 'active', '启用')"
              >
                启用
              </el-button>
              <el-button
                link
                type="danger"
                size="small"
                :icon="Delete"
                :disabled="isSelf(row)"
                @click="handleDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无符合条件的账号" :image-size="60" />
          </template>
        </el-table>

        <div class="acct-pager">
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

    <!-- 新建 / 编辑 -->
    <el-drawer
      v-model="drawerOpen"
      :title="isCreate ? '新建账号' : `编辑账号 · ${editing?.real_name ?? ''}`"
      size="540px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px">
        <el-form-item v-if="isCreate" label="登录账号" prop="username">
          <el-input v-model="form.username" placeholder="如 zhangsan" />
        </el-form-item>
        <el-form-item v-else label="登录账号">
          <el-input :model-value="editing?.username ?? ''" disabled />
          <div class="acct-hint">账号名创建后不可修改</div>
        </el-form-item>
        <el-form-item label="姓名" prop="real_name">
          <el-input v-model="form.real_name" maxlength="64" placeholder="账号持有人的真实姓名" />
        </el-form-item>
        <div class="acct-form-row">
          <el-form-item class="acct-form-flex" label="工号" prop="employee_no">
            <el-input v-model="form.employee_no" clearable maxlength="64" placeholder="医院工号，可留空" />
          </el-form-item>
          <el-form-item class="acct-form-flex" label="性别" prop="gender">
            <el-select v-model="form.gender">
              <el-option
                v-for="g in GENDER_OPTIONS"
                :key="g.value"
                :label="g.label"
                :value="g.value"
              />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="职称 / 岗位" prop="professional_title">
          <el-input
            v-model="form.professional_title"
            clearable
            maxlength="64"
            placeholder="如 主治医师 / 责任护士"
          />
        </el-form-item>
        <el-form-item label="所属科室" prop="department_id">
          <el-select
            v-model="form.department_id"
            clearable
            filterable
            placeholder="选择科室"
            :loading="optionsLoading"
          >
            <el-option
              v-for="d in options.departments"
              :key="d.id"
              :label="d.department_name"
              :value="d.id"
            />
          </el-select>
          <div class="acct-hint">用于区分业务归属，可稍后调整</div>
        </el-form-item>
        <el-form-item label="角色" prop="role_ids">
          <el-select
            v-model="form.role_ids"
            multiple
            placeholder="选择该账号拥有的角色（可多选）"
            :loading="optionsLoading"
          >
            <el-option
              v-for="r in options.roles"
              :key="r.id"
              :label="r.role_name"
              :value="r.id"
              :disabled="roleDisabled(r.role_code)"
            >
              <div>
                <span>{{ r.role_name }}</span>
                <span v-if="r.description" class="acct-option-desc">{{ r.description }}</span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <template v-if="isCreate">
          <el-form-item label="初始密码" prop="password">
            <el-input
              v-model="form.password"
              autocomplete="new-password"
              maxlength="128"
              show-password
              placeholder="留空自动生成"
            />
            <div class="acct-hint">
              留空则由系统自动生成 12 位随机密码；该账号首次登录将强制修改密码。
            </div>
          </el-form-item>
          <el-form-item label="账号状态" prop="status">
            <el-radio-group v-model="form.status">
              <el-radio value="active">启用（可立即登录）</el-radio>
              <el-radio value="pending">待启用</el-radio>
            </el-radio-group>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="drawerOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-drawer>

    <!-- 创建成功：一次性初始密码 -->
    <el-dialog
      v-model="createdAccount"
      title="账号创建成功"
      width="520"
      :close-on-click-modal="false"
      :show-close="false"
    >
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        title="请立即保存初始密码"
        description="初始密码仅展示这一次，关闭后将无法再次查看。请及时转交给对应人员，并提醒其登录后修改密码。"
      />
      <div class="acct-password-box">
        <div>
          <div class="acct-label">登录账号</div>
          <el-input :model-value="createdAccount?.username" readonly />
        </div>
        <div>
          <div class="acct-label">初始密码</div>
          <el-input :model-value="createdAccount?.password" readonly>
            <template #append>
              <el-button @click="copyText(createdAccount?.password ?? '', '初始密码')">
                复制
              </el-button>
            </template>
          </el-input>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="createdAccount = null">知道了</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog
      v-model="resetOpen"
      :title="`重置密码 · ${resetTarget?.real_name ?? ''}`"
      width="520"
      :close-on-click-modal="false"
    >
      <template v-if="resetDone">
        <el-alert
          type="warning"
          show-icon
          :closable="false"
          title="新密码已生效，仅展示这一次"
          description="该账号已要求下次登录时修改密码，请及时转告账号持有人。"
        />
        <div class="acct-password-box">
          <el-input :model-value="resetDone" readonly>
            <template #append>
              <el-button @click="copyText(resetDone ?? '', '新密码')">复制</el-button>
            </template>
          </el-input>
        </div>
      </template>
      <template v-else>
        <el-form label-width="72px">
          <el-form-item label="新密码">
            <el-input
              v-model="resetDraft"
              autocomplete="new-password"
              maxlength="128"
              show-password
              placeholder="输入新密码（8-128 位），或点击「自动生成」"
            />
            <div class="acct-hint">
              重置后该账号现有登录会话将全部失效，需使用新密码重新登录。
            </div>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button
          v-if="!resetDone"
          :disabled="!!resetDraft.trim()"
          @click="handleReset(true)"
        >
          自动生成
        </el-button>
        <el-button v-if="resetDone" type="primary" @click="resetOpen = false">完成</el-button>
        <el-button
          v-else
          type="primary"
          :loading="resetSubmitting"
          @click="handleReset(false)"
        >
          重置并保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 批量导入 -->
    <el-dialog v-model="importOpen" title="批量导入账号" width="680" :close-on-click-modal="false">
      <template v-if="importResult">
        <el-alert
          type="success"
          show-icon
          :closable="false"
          :title="`成功创建 ${importResult.created} 个账号`"
          :description="
            importResult.failed.length
              ? `以下 ${importResult.failed.length} 行未导入，可按提示修正后重新粘贴导入。`
              : '全部导入成功。'
          "
        />
        <template v-if="importResult.accounts.length">
          <el-alert
            class="acct-gap"
            type="warning"
            show-icon
            :closable="false"
            title="初始密码仅本次展示，请立即转交对应人员并提醒其登录后修改密码"
          />
          <el-table :data="importResult.accounts" size="small" border max-height="240">
            <el-table-column label="登录账号" prop="username" width="160">
              <template #default="{ row }">
                <span class="acct-mono">{{ row.username }}</span>
              </template>
            </el-table-column>
            <el-table-column label="姓名" prop="real_name" />
            <el-table-column label="初始密码" prop="password">
              <template #default="{ row }">
                <div class="acct-pwd-cell">
                  <code>{{ row.password }}</code>
                  <el-button link type="primary" size="small" @click="copyText(row.password, '密码')">
                    复制
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </template>
        <div v-if="importResult.failed.length" class="acct-failed">
          <div class="acct-failed-title">未导入行（{{ importResult.failed.length }}）</div>
          <div v-for="f in importResult.failed" :key="`${f.line}-${f.reason}`" class="acct-failed-item">
            <code>第 {{ f.line }} 行</code>
            <span>{{ f.reason }}</span>
          </div>
        </div>
      </template>
      <template v-else>
        <p class="acct-hint acct-hint--block">
          每行一条，格式 <code>账号,姓名[,科室编码,角色编码,初始密码]</code>；
          科室与角色缺省时可不填，角色缺省为「医生」，密码留空自动生成（8-128 位）。
          空行与 <code>#</code> 开头行自动跳过，重复账号行会跳过并在下方提示。
        </p>
        <el-input
          v-model="importText"
          type="textarea"
          :rows="10"
          placeholder="zhangsan,张三,cardiology,doctor,Zhang@1234&#10;lisi,李四,,auditor,&#10;wangwu,王五"
        />
      </template>
      <template #footer>
        <template v-if="importResult">
          <el-button
            @click="
              importResult = null;
              importText = '';
            "
          >
            继续导入
          </el-button>
          <el-button type="primary" @click="importOpen = false">完成</el-button>
        </template>
        <template v-else>
          <el-button @click="importOpen = false">取消</el-button>
          <el-button
            type="primary"
            :loading="importing"
            :disabled="!importText.trim()"
            @click="handleImport"
          >
            开始导入
          </el-button>
        </template>
      </template>
    </el-dialog>
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

.acct-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.acct-search {
  width: 230px;
}

.acct-select {
  width: 150px;
}

.acct-total {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.acct-username {
  display: flex;
  align-items: center;
  gap: 6px;
}

.acct-mono {
  font-family: var(--el-font-family-monospace, Consolas, monospace);
}

.acct-name {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.acct-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.acct-sub--block {
  display: block;
}

.acct-roles {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.acct-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.acct-hint {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.acct-hint--block {
  margin: 0 0 10px;
  font-size: 13px;
}

.acct-form-row {
  display: flex;
  gap: 12px;
}

.acct-form-flex {
  flex: 1;
  min-width: 0;
}

.acct-option-desc {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

.acct-password-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.acct-label {
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.acct-gap {
  margin-top: 12px;
}

.acct-pwd-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.acct-pwd-cell code {
  font-family: var(--el-font-family-monospace, Consolas, monospace);
  font-size: 12.5px;
}

.acct-failed {
  margin-top: 12px;
}

.acct-failed-title {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
}

.acct-failed-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.8;
}
</style>
