<script lang="ts" setup>
/**
 * 权限管理（迁移自 med-work-frontend Permissions）：
 * 角色列表（关键词/状态筛选 + 分页） + 角色抽屉（资料 + 菜单授权树 + 功能权限点授权树）
 * + 启停/删除；系统内置角色仅允许修改说明（树只读）。按 `organization:role:manage` 控制。
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';

import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
  type TreeInstance,
} from 'element-plus';
import {
  Delete,
  Edit,
  Lock,
  Plus,
  Refresh,
  Unlock,
} from '@element-plus/icons-vue';

import PageHead from '#/components/med/page-head.vue';
import {
  createRole,
  deleteRole,
  getRole,
  getRoleMenuTree,
  getRolePermissionTree,
  getRoles,
  setRoleStatus,
  updateRole,
} from '#/api/med/roles';
import type {
  DataScopeCode,
  RoleItem,
  RoleMenuTreeNode,
  RolePermissionTreeNode,
  RoleStatus,
} from '#/types/med';
import { useAccessStore } from '@vben/stores';

// ==================== 权限 ====================

const accessStore = useAccessStore();
const canManage = computed(() =>
  accessStore.accessCodes?.includes('organization:role:manage'),
);

const STATUS_META: Record<RoleStatus, { label: string; type: 'info' | 'success' }> = {
  active: { label: '启用', type: 'success' },
  disabled: { label: '已停用', type: 'info' },
};

const DATA_SCOPE_META: Record<DataScopeCode, { description: string; label: string; type: 'info' | 'primary' | 'success' | 'warning' }> = {
  department: { description: '可查看本科室范围内的数据', label: '本科室数据', type: 'primary' },
  department_tree: {
    description: '可查看本科室及其下级科室的数据',
    label: '科室及下级科室',
    type: 'success',
  },
  hospital: {
    description: '可查看全院数据（范围最大，请谨慎授权）',
    label: '全院数据',
    type: 'warning',
  },
  self: { description: '只能查看本人负责的数据（范围最小，默认）', label: '仅本人数据', type: 'info' },
};

const DATA_SCOPE_ORDER: DataScopeCode[] = [
  'self',
  'department',
  'department_tree',
  'hospital',
];

const ROLE_TYPE: Record<string, 'danger' | 'info' | 'primary' | 'success' | 'warning'> = {
  auditor: 'warning',
  doctor: 'primary',
  hospital_admin: 'danger',
  knowledge_admin: 'success',
};

// ==================== 列表 ====================

const rows = ref<RoleItem[]>([]);
const loading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const searchText = ref('');
const filterStatus = ref<RoleStatus | ''>('');

async function load() {
  loading.value = true;
  try {
    const res = await getRoles({
      keyword: searchText.value.trim() || undefined,
      page: page.value,
      page_size: pageSize.value,
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

onMounted(() => {
  void load();
  void loadMenuTree();
  void loadPermissionTree();
});

watch([page, pageSize, filterStatus], () => void load());

function resetFilters() {
  searchText.value = '';
  filterStatus.value = '';
  page.value = 1;
  void load();
}

function fmtTime(value?: null | string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—';
}

// ==================== 授权树 ====================

const menuTree = ref<RoleMenuTreeNode[]>([]);
const treeLoading = ref(false);
const permissionTree = ref<RolePermissionTreeNode[]>([]);
const permTreeLoading = ref(false);

const menuTreeRef = ref<TreeInstance>();
const permTreeRef = ref<TreeInstance>();
const checkedMenuKeys = ref<string[]>([]);
const checkedPermissionKeys = ref<string[]>([]);

async function loadMenuTree() {
  treeLoading.value = true;
  try {
    const res = await getRoleMenuTree();
    menuTree.value = res.items ?? [];
  } catch {
    /* request 层已提示 */
  } finally {
    treeLoading.value = false;
  }
}

async function loadPermissionTree() {
  permTreeLoading.value = true;
  try {
    const res = await getRolePermissionTree();
    permissionTree.value = res.items ?? [];
  } catch {
    /* request 层已提示 */
  } finally {
    permTreeLoading.value = false;
  }
}

/** 收集所有含子节点的 key（默认展开用） */
function collectParentKeys(nodes: RoleMenuTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: RoleMenuTreeNode[] | undefined) => {
    (list ?? []).forEach((node) => {
      if (node.children?.length) {
        keys.push(node.key);
        walk(node.children);
      }
    });
  };
  walk(nodes);
  return keys;
}

const expandedMenuKeys = computed(() => collectParentKeys(menuTree.value));
const expandedPermKeys = computed(() => permissionTree.value.map((n) => n.key));

// ==================== 新建 / 编辑抽屉 ====================

const drawerOpen = ref(false);
const drawerMode = ref<'create' | 'edit'>('create');
const editing = ref<null | RoleItem>(null);
const detailLoading = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();

const form = reactive({
  data_scope: 'self' as DataScopeCode,
  description: '',
  role_code: '',
  role_name: '',
  status: 'active' as RoleStatus,
});

const isCreate = computed(() => drawerMode.value === 'create');
const isSystemEditing = computed(() => editing.value?.is_system === true);
const treeReadonly = computed(() => isSystemEditing.value || detailLoading.value);

const rules: FormRules = {
  role_code: [
    { message: '请输入角色编码', required: true, trigger: 'blur' },
    {
      message: '小写字母开头，仅含小写字母 / 数字 / 下划线',
      pattern: /^[a-z][a-z0-9_]{1,63}$/,
      trigger: 'blur',
    },
  ],
  role_name: [{ message: '请输入角色名称', required: true, trigger: 'blur' }],
};

function openCreate() {
  drawerMode.value = 'create';
  editing.value = null;
  Object.assign(form, {
    data_scope: 'self',
    description: '',
    role_code: '',
    role_name: '',
    status: 'active',
  });
  checkedMenuKeys.value = [];
  checkedPermissionKeys.value = [];
  drawerOpen.value = true;
}

async function openEdit(item: RoleItem) {
  drawerMode.value = 'edit';
  editing.value = item;
  checkedMenuKeys.value = [];
  checkedPermissionKeys.value = [];
  drawerOpen.value = true;
  detailLoading.value = true;
  try {
    const detail = await getRole(item.id);
    Object.assign(form, {
      data_scope: (detail.data_scope as DataScopeCode) ?? 'self',
      description: detail.description ?? '',
      role_code: detail.role_code,
      role_name: detail.role_name,
      status: detail.status,
    });
    checkedMenuKeys.value = detail.menu_keys ?? [];
    checkedPermissionKeys.value = detail.permission_keys ?? [];
    await nextTick();
    menuTreeRef.value?.setCheckedKeys(checkedMenuKeys.value, false);
    permTreeRef.value?.setCheckedKeys(checkedPermissionKeys.value, false);
  } catch {
    // 加载失败关闭抽屉，避免在空数据上误保存
    drawerOpen.value = false;
    editing.value = null;
  } finally {
    detailLoading.value = false;
  }
}

async function submit() {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    const menuKeys = (menuTreeRef.value?.getCheckedKeys(false) ?? []) as string[];
    const permKeys = (permTreeRef.value?.getCheckedKeys(false) ?? []) as string[];
    if (isCreate.value) {
      const res = await createRole({
        data_scope: form.data_scope,
        description: form.description.trim() || null,
        menu_keys: menuKeys,
        permission_keys: permKeys,
        role_code: form.role_code.trim(),
        role_name: form.role_name.trim(),
        status: form.status,
      });
      ElMessage.success(`角色「${res.role_name}」已创建`);
    } else if (editing.value) {
      const description = form.description.trim() || null;
      if (isSystemEditing.value) {
        await updateRole(editing.value.id, { description });
        ElMessage.success('角色说明已更新');
      } else {
        await updateRole(editing.value.id, {
          data_scope: form.data_scope,
          description,
          menu_keys: menuKeys,
          permission_keys: permKeys,
          role_name: form.role_name.trim(),
          status: form.status,
        });
        ElMessage.success(`角色「${editing.value.role_name}」已更新`);
      }
    }
    drawerOpen.value = false;
    editing.value = null;
    await load();
  } catch {
    /* request 层已提示（编码重复 / 名称重复等） */
  } finally {
    submitting.value = false;
  }
}

// ==================== 启停 / 删除 ====================

async function toggleStatus(item: RoleItem, status: RoleStatus, text: string) {
  try {
    await setRoleStatus(item.id, status);
    ElMessage.success(`角色「${item.role_name}」已${text}`);
    await load();
  } catch {
    /* request 层已提示 */
  }
}

async function handleDisable(item: RoleItem) {
  try {
    await ElMessageBox.confirm(
      '停用后该角色所有成员的权限即时失效；重新启用角色可恢复其成员的授权。',
      `停用角色「${item.role_name}」？`,
      { type: 'warning' },
    );
  } catch {
    return;
  }
  await toggleStatus(item, 'disabled', '停用');
}

async function handleDelete(item: RoleItem) {
  try {
    await ElMessageBox.confirm(
      '删除后角色定义将被移除，不可恢复；仍有成员时无法删除。',
      `删除角色「${item.role_name}」？`,
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await deleteRole(item.id);
    ElMessage.success(`角色「${item.role_name}」已删除`);
    await load();
  } catch {
    /* request 层已提示 */
  }
}
</script>

<template>
  <div class="med-page">
    <div class="med-page-inner">
      <PageHead
        :crumbs="[{ label: '系统管理' }, { label: '权限管理', current: true }]"
        title="权限管理"
        subtitle="配置院内角色可访问的功能菜单、可操作的功能权限点，并通过数据范围控制账号的数据可见边界"
      >
        <template #actions>
          <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
          <el-button
            v-if="canManage"
            type="primary"
            :icon="Plus"
            @click="openCreate"
          >
            新建角色
          </el-button>
        </template>
      </PageHead>

      <el-card shadow="never">
        <div class="perm-filters">
          <el-input
            v-model="searchText"
            clearable
            placeholder="搜索角色名称 / 编码"
            class="perm-search"
            @keyup.enter="page = 1; load()"
          />
          <el-select v-model="filterStatus" clearable placeholder="全部状态" class="perm-select">
            <el-option label="启用" value="active" />
            <el-option label="已停用" value="disabled" />
          </el-select>
          <el-button text @click="resetFilters">重置</el-button>
          <span class="perm-total">共 {{ total }} 个角色</span>
        </div>
      </el-card>

      <el-card shadow="never">
        <el-table v-loading="loading" :data="rows" row-key="id" border stripe>
          <el-table-column label="角色名称" prop="role_name" min-width="200">
            <template #default="{ row }">
              <div class="perm-name">
                <span class="perm-name-text">{{ row.role_name }}</span>
                <el-tag
                  v-if="row.is_system"
                  :type="ROLE_TYPE[row.role_code] ?? 'warning'"
                  size="small"
                >
                  系统内置
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="角色编码" prop="role_code" min-width="160">
            <template #default="{ row }">
              <span class="perm-mono">{{ row.role_code }}</span>
            </template>
          </el-table-column>
          <el-table-column label="数据范围" prop="data_scope" width="170">
            <template #default="{ row }">
              <el-tooltip
                v-if="DATA_SCOPE_META[row.data_scope as DataScopeCode]"
                :content="DATA_SCOPE_META[row.data_scope as DataScopeCode].description"
                placement="top"
              >
                <el-tag :type="DATA_SCOPE_META[row.data_scope as DataScopeCode].type" size="small">
                  {{ DATA_SCOPE_META[row.data_scope as DataScopeCode].label }}
                </el-tag>
              </el-tooltip>
              <span v-else>{{ row.data_scope || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column align="center" label="成员数" prop="member_count" width="90">
            <template #default="{ row }">{{ row.member_count > 0 ? row.member_count : '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" prop="status" width="100">
            <template #default="{ row }">
              <el-tag :type="STATUS_META[row.status as RoleStatus].type" size="small">
                {{ STATUS_META[row.status as RoleStatus].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" prop="updated_at" width="150">
            <template #default="{ row }">
              <span class="perm-sub">{{ fmtTime(row.updated_at) }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="canManage" fixed="right" label="操作" width="200">
            <template #default="{ row }">
              <el-button link type="primary" size="small" :icon="Edit" @click="openEdit(row)">
                编辑
              </el-button>
              <template v-if="row.is_system">
                <el-button link type="info" size="small" :icon="Lock" disabled>停用</el-button>
              </template>
              <el-button
                v-else-if="row.status === 'disabled'"
                link
                type="primary"
                size="small"
                :icon="Unlock"
                @click="toggleStatus(row, 'active', '启用')"
              >
                启用
              </el-button>
              <el-button
                v-else
                link
                type="danger"
                size="small"
                :icon="Lock"
                @click="handleDisable(row)"
              >
                停用
              </el-button>
              <el-button
                link
                type="danger"
                size="small"
                :icon="Delete"
                :disabled="row.is_system"
                @click="handleDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无符合条件的角色" :image-size="60" />
          </template>
        </el-table>

        <div class="perm-pager">
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

    <!-- 新建 / 编辑角色 -->
    <el-drawer
      v-model="drawerOpen"
      :title="isCreate ? '新建角色' : `编辑角色 · ${editing?.role_name ?? ''}`"
      size="720px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-alert
        v-if="isSystemEditing"
        class="perm-alert"
        type="info"
        show-icon
        :closable="false"
        title="系统内置角色"
        description="系统内置角色的编码、数据范围、状态、菜单与功能权限点授权由系统统一维护，这里仅可修改角色说明。"
      />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px">
        <el-form-item label="角色编码" prop="role_code">
          <el-input
            v-model="form.role_code"
            :disabled="!isCreate"
            maxlength="64"
            placeholder="如 chief_nurse"
          />
          <div v-if="!isCreate" class="perm-hint">角色编码创建后不可修改</div>
        </el-form-item>
        <el-form-item label="角色名称" prop="role_name">
          <el-input
            v-model="form.role_name"
            :disabled="isSystemEditing"
            maxlength="64"
            placeholder="如 护士长"
          />
        </el-form-item>
        <el-form-item label="数据范围" prop="data_scope">
          <el-select v-model="form.data_scope" :disabled="isSystemEditing">
            <el-option
              v-for="s in DATA_SCOPE_ORDER"
              :key="s"
              :label="DATA_SCOPE_META[s].label"
              :value="s"
            />
          </el-select>
          <div class="perm-hint">
            数据范围决定该角色账号能查看的数据边界，请结合岗位职责谨慎授权。
          </div>
        </el-form-item>
        <el-form-item v-if="!isSystemEditing" label="角色状态" prop="status">
          <el-radio-group v-model="form.status">
            <el-radio value="active">启用</el-radio>
            <el-radio value="disabled">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="角色说明" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            maxlength="255"
            show-word-limit
            placeholder="说明该角色的职责、适用范围等（可选）"
          />
        </el-form-item>
      </el-form>

      <!-- 菜单授权 -->
      <el-card shadow="never" class="perm-sub-card">
        <template #header>
          <div class="perm-sub-title">
            <span>菜单授权</span>
            <el-tag v-if="isSystemEditing" type="warning" size="small">系统统一维护</el-tag>
            <span v-if="!treeReadonly" class="perm-sub-count">
              已勾选 {{ checkedMenuKeys.length }} 项
            </span>
          </div>
        </template>
        <p class="perm-hint perm-hint--block">
          {{
            isSystemEditing
              ? '系统内置角色的授权范围由系统统一管理，不可修改。'
              : '勾选该角色登录后可访问的功能菜单，未勾选的页面将不展示。'
          }}
        </p>
        <el-tree
          ref="menuTreeRef"
          v-loading="treeLoading"
          :data="menuTree"
          :props="{ children: 'children', label: 'title' }"
          :default-expanded-keys="expandedMenuKeys"
          :disabled="treeReadonly"
          node-key="key"
          show-checkbox
          @check="(_node: unknown, state: { checkedKeys: string[] }) => (checkedMenuKeys = state.checkedKeys)"
        />
      </el-card>

      <!-- 功能权限点授权 -->
      <el-card shadow="never" class="perm-sub-card">
        <template #header>
          <div class="perm-sub-title">
            <span>功能权限点授权</span>
            <el-tag v-if="isSystemEditing" type="warning" size="small">系统统一维护</el-tag>
            <span v-if="!treeReadonly" class="perm-sub-count">
              已勾选 {{ checkedPermissionKeys.length }} 项
            </span>
          </div>
        </template>
        <p class="perm-hint perm-hint--block">
          {{
            isSystemEditing
              ? '系统内置角色的权限点授权由系统统一管理，不可修改。'
              : '权限点决定页面内的按钮与操作（如新建患者、发起 AI 分析、删除文档），未勾选的操作前端自动隐藏，后端同样拦截。'
          }}
        </p>
        <el-tree
          ref="permTreeRef"
          v-loading="permTreeLoading"
          :data="permissionTree"
          :props="{ children: 'children', disabled: (data: RolePermissionTreeNode) => data.selectable === false, label: 'title' }"
          :default-expanded-keys="expandedPermKeys"
          :disabled="treeReadonly"
          node-key="key"
          show-checkbox
          @check="(_node: unknown, state: { checkedKeys: string[] }) => (checkedPermissionKeys = state.checkedKeys)"
        >
          <template #default="{ data }">
            <el-tooltip v-if="data.description" :content="data.description" placement="top">
              <span>{{ data.title }}</span>
            </el-tooltip>
            <span v-else>{{ data.title }}</span>
          </template>
        </el-tree>
      </el-card>

      <template #footer>
        <el-button :disabled="submitting" @click="drawerOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">
          {{ isCreate ? '创建角色' : '保存' }}
        </el-button>
      </template>
    </el-drawer>
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

.perm-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.perm-search {
  width: 230px;
}

.perm-select {
  width: 130px;
}

.perm-total {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.perm-name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.perm-name-text {
  font-weight: 600;
}

.perm-mono {
  font-family: var(--el-font-family-monospace, Consolas, monospace);
}

.perm-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.perm-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.perm-hint {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.perm-hint--block {
  margin: 0 0 8px;
}

.perm-alert {
  margin-bottom: 16px;
}

.perm-sub-card {
  margin-top: 16px;
}

.perm-sub-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.perm-sub-count {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}
</style>
