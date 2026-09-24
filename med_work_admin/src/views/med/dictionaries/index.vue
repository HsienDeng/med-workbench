<script lang="ts" setup>
/**
 * 字典管理（迁移自 med-work-frontend Dictionaries）：
 * 左栏字典列表（关键词/分类/状态筛选 + 分页 + 新建/编辑/删除），
 * 右栏选中字典的字典项表格（分页 + 新增/编辑/启停/删除 + 批量文本导入）。
 * 维护操作按 `dictionary:manage` 权限控制。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  Delete,
  Edit,
  Lock,
  Plus,
  Refresh,
  Upload,
} from '@element-plus/icons-vue';
import dayjs from 'dayjs';

import PageHead from '#/components/med/page-head.vue';
import {
  batchCreateDictionaryItems,
  createDictionary,
  createDictionaryItem,
  deleteDictionary,
  deleteDictionaryItem,
  getDictionaries,
  getDictionaryCategories,
  getDictionaryItems,
  updateDictionary,
  updateDictionaryItem,
} from '#/api/med/dictionaries';
import type {
  Dictionary,
  DictionaryCategory,
  DictionaryCategoryOption,
  DictionaryItem,
  DictionaryStatus,
} from '#/types/med';
import { useAccessStore } from '@vben/stores';

const accessStore = useAccessStore();
const canManage = computed(() =>
  accessStore.accessCodes?.includes('dictionary:manage'),
);

const CATEGORY_TAG: Record<DictionaryCategory, 'primary' | 'success' | 'warning' | 'info'> = {
  business: 'warning',
  clinical: 'primary',
  coding: 'info',
  lab: 'success',
};

// ==================== 字典列表 ====================

const categories = ref<DictionaryCategoryOption[]>([]);
const dictionaries = ref<Dictionary[]>([]);
const dictLoading = ref(false);
const dictTotal = ref(0);
const dictPage = ref(1);
const dictPageSize = 10;
const keyword = ref('');
const category = ref<DictionaryCategory | ''>('');
const status = ref<DictionaryStatus | ''>('');
const selectedDictId = ref<null | number>(null);

const activeDict = computed(
  () => dictionaries.value.find((d) => d.id === selectedDictId.value) ?? null,
);

async function loadCategories() {
  try {
    categories.value = await getDictionaryCategories();
  } catch {
    /* 分类可为空 */
  }
}

async function loadDictionaries() {
  dictLoading.value = true;
  try {
    const res = await getDictionaries({
      category: category.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: dictPage.value,
      pageSize: dictPageSize,
      status: status.value || undefined,
    });
    dictionaries.value = res.items ?? [];
    dictTotal.value = res.total ?? 0;
    if (selectedDictId.value === null && dictionaries.value.length > 0) {
      selectedDictId.value = dictionaries.value[0]!.id;
    }
  } catch {
    /* request 层已提示 */
  } finally {
    dictLoading.value = false;
  }
}

// ==================== 字典项 ====================

const items = ref<DictionaryItem[]>([]);
const itemLoading = ref(false);
const itemTotal = ref(0);
const itemPage = ref(1);
const itemPageSize = ref(20);
const itemKeyword = ref('');
const itemStatus = ref<DictionaryStatus | ''>('');
const itemSearchText = ref('');

async function loadItems() {
  if (!selectedDictId.value) {
    items.value = [];
    itemTotal.value = 0;
    return;
  }
  itemLoading.value = true;
  try {
    const res = await getDictionaryItems(selectedDictId.value, {
      keyword: itemKeyword.value.trim() || undefined,
      page: itemPage.value,
      pageSize: itemPageSize.value,
      status: itemStatus.value || undefined,
    });
    items.value = res.items ?? [];
    itemTotal.value = res.total ?? 0;
  } catch {
    /* request 层已提示 */
  } finally {
    itemLoading.value = false;
  }
}

onMounted(async () => {
  await loadCategories();
  await loadDictionaries();
});

watch(
  [keyword, category, status, dictPage],
  () => {
    void loadDictionaries();
  },
);

watch(
  [selectedDictId, itemKeyword, itemStatus, itemPage, itemPageSize],
  () => {
    void loadItems();
  },
);

function selectDictionary(id: number) {
  selectedDictId.value = id;
  itemPage.value = 1;
  itemKeyword.value = '';
  itemSearchText.value = '';
}

function refreshAll() {
  void loadDictionaries();
  void loadItems();
}

// ==================== 字典表单弹窗 ====================

const dictModalOpen = ref(false);
const editingDict = ref<null | Dictionary>(null);
const dictFormRef = ref<FormInstance>();
const dictForm = reactive({
  category: 'business' as DictionaryCategory,
  description: '',
  dict_code: '',
  dict_name: '',
  sort_order: 0,
  status: 'active' as DictionaryStatus,
});

const dictRules: FormRules = {
  dict_code: [
    { message: '请输入字典编码', required: true, trigger: 'blur' },
    {
      message: '仅支持字母、数字与下划线',
      pattern: /^[A-Za-z0-9_]+$/,
      trigger: 'blur',
    },
  ],
  dict_name: [{ message: '请输入字典名称', required: true, trigger: 'blur' }],
};

function openCreateDict() {
  editingDict.value = null;
  Object.assign(dictForm, {
    category: 'business',
    description: '',
    dict_code: '',
    dict_name: '',
    sort_order: 0,
    status: 'active',
  });
  dictModalOpen.value = true;
}

function openEditDict(dict: Dictionary) {
  editingDict.value = dict;
  Object.assign(dictForm, {
    category: dict.category,
    description: dict.description ?? '',
    dict_code: dict.dict_code,
    dict_name: dict.dict_name,
    sort_order: dict.sort_order,
    status: dict.status,
  });
  dictModalOpen.value = true;
}

async function submitDict() {
  if (!dictFormRef.value) return;
  const valid = await dictFormRef.value.validate().catch(() => false);
  if (!valid) return;
  const payload = {
    category: dictForm.category,
    description: dictForm.description.trim() || null,
    dict_code: dictForm.dict_code.trim(),
    dict_name: dictForm.dict_name.trim(),
    sort_order: dictForm.sort_order ?? 0,
    status: dictForm.status,
  };
  try {
    if (editingDict.value) {
      const { dict_code: _code, ...updatePayload } = payload;
      await updateDictionary(editingDict.value.id, updatePayload);
      ElMessage.success('字典已更新');
    } else {
      await createDictionary(payload);
      ElMessage.success('字典已创建');
    }
    dictModalOpen.value = false;
    await loadDictionaries();
  } catch {
    /* request 层已提示 */
  }
}

async function handleDeleteDict(dict: Dictionary) {
  try {
    await ElMessageBox.confirm(
      dict.builtin
        ? '内置字典不可删除'
        : '删除后不可恢复，仅当字典下无字典项时可删除。',
      `删除字典「${dict.dict_name}」？`,
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await deleteDictionary(dict.id);
    ElMessage.success(`字典「${dict.dict_name}」已删除`);
    if (selectedDictId.value === dict.id) selectedDictId.value = null;
    await loadDictionaries();
  } catch {
    /* request 层已提示 */
  }
}

// ==================== 字典项表单弹窗 ====================

const itemModalOpen = ref(false);
const editingItem = ref<null | DictionaryItem>(null);
const itemFormRef = ref<FormInstance>();
const itemForm = reactive({
  item_code: '',
  item_label: '',
  item_value: '',
  remark: '',
  sort_order: 10,
  status: 'active' as DictionaryStatus,
});

const itemRules: FormRules = {
  item_code: [
    { message: '请输入项编码', required: true, trigger: 'blur' },
    {
      message: '仅支持字母、数字、下划线、点与短横线',
      pattern: /^[A-Za-z0-9_.\-]+$/,
      trigger: 'blur',
    },
  ],
  item_label: [{ message: '请输入显示名称', required: true, trigger: 'blur' }],
};

function openCreateItem() {
  editingItem.value = null;
  const last = items.value.at(-1);
  Object.assign(itemForm, {
    item_code: '',
    item_label: '',
    item_value: '',
    remark: '',
    sort_order: (last?.sort_order ?? 0) + 10,
    status: 'active',
  });
  itemModalOpen.value = true;
}

function openEditItem(item: DictionaryItem) {
  editingItem.value = item;
  Object.assign(itemForm, {
    item_code: item.item_code,
    item_label: item.item_label,
    item_value: item.item_value ?? '',
    remark: item.remark ?? '',
    sort_order: item.sort_order,
    status: item.status,
  });
  itemModalOpen.value = true;
}

async function submitItem() {
  if (!itemFormRef.value || !selectedDictId.value) return;
  const valid = await itemFormRef.value.validate().catch(() => false);
  if (!valid) return;
  const payload = {
    item_code: itemForm.item_code.trim(),
    item_label: itemForm.item_label.trim(),
    item_value: itemForm.item_value.trim() || null,
    remark: itemForm.remark.trim() || null,
    sort_order: itemForm.sort_order ?? 0,
    status: itemForm.status,
  };
  try {
    if (editingItem.value) {
      const { item_code: _code, ...updatePayload } = payload;
      await updateDictionaryItem(editingItem.value.id, updatePayload);
      ElMessage.success('字典项已更新');
    } else {
      await createDictionaryItem(selectedDictId.value, payload);
      ElMessage.success('字典项已新增');
    }
    itemModalOpen.value = false;
    await loadItems();
    await loadDictionaries();
  } catch {
    /* request 层已提示 */
  }
}

async function handleToggleItem(item: DictionaryItem) {
  const next = item.status === 'active' ? 'disabled' : 'active';
  try {
    await updateDictionaryItem(item.id, { status: next });
    ElMessage.success(next === 'active' ? '已启用' : '已停用');
    await loadItems();
  } catch {
    /* request 层已提示 */
  }
}

async function handleDeleteItem(item: DictionaryItem) {
  try {
    await ElMessageBox.confirm(
      '删除后不可恢复，引用该编码的下拉将不再展示此项。',
      '删除该字典项？',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await deleteDictionaryItem(item.id);
    ElMessage.success('字典项已删除');
    await loadItems();
    await loadDictionaries();
  } catch {
    /* request 层已提示 */
  }
}

// ==================== 批量导入 ====================

const batchModalOpen = ref(false);
const batchText = ref('');

async function submitBatch() {
  if (!selectedDictId.value || !batchText.value.trim()) return;
  try {
    const res = await batchCreateDictionaryItems(
      selectedDictId.value,
      batchText.value,
    );
    ElMessage.success(`已导入 ${res.created ?? 0} 个字典项`);
    batchModalOpen.value = false;
    batchText.value = '';
    await loadItems();
    await loadDictionaries();
  } catch {
    /* request 层已提示 */
  }
}

function fmtTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}
</script>

<template>
  <div class="med-page">
    <div class="med-page-inner">
      <PageHead
        :crumbs="[{ label: '系统管理' }, { label: '字典管理', current: true }]"
        title="字典管理"
        subtitle="统一维护平台数据字典，供文档分类、患者档案、分析任务等下拉选项复用"
      >
        <template #actions>
          <el-button :icon="Refresh" :loading="dictLoading" @click="refreshAll">
            刷新
          </el-button>
          <el-button
            v-if="canManage"
            type="primary"
            :icon="Plus"
            @click="openCreateDict"
          >
            新建字典
          </el-button>
        </template>
      </PageHead>

      <div class="dict-layout">
        <!-- 左栏：字典列表 -->
        <el-card shadow="never" class="dict-sidebar">
          <template #header>
            <div class="dict-card-title">
              <span class="dict-card-name">字典列表</span>
              <span class="dict-card-sub">共 {{ dictTotal }} 个字典</span>
            </div>
          </template>

          <div class="dict-filters">
            <el-input
              v-model="keyword"
              clearable
              placeholder="搜索编码或名称"
              @keyup.enter="dictPage = 1"
            />
            <el-select
              v-model="category"
              clearable
              placeholder="全部分类"
              @change="dictPage = 1"
            >
              <el-option
                v-for="c in categories"
                :key="c.value"
                :label="c.label"
                :value="c.value"
              />
            </el-select>
            <el-radio-group v-model="status" size="small" @change="dictPage = 1">
              <el-radio-button value="">全部</el-radio-button>
              <el-radio-button value="active">启用</el-radio-button>
              <el-radio-button value="disabled">停用</el-radio-button>
            </el-radio-group>
          </div>

          <div v-loading="dictLoading" class="dict-list">
            <el-empty
              v-if="!dictionaries.length && !dictLoading"
              description="暂无符合条件的字典"
              :image-size="60"
            />
            <div
              v-for="dict in dictionaries"
              v-else
              :key="dict.id"
              :class="['dict-item', { 'is-active': dict.id === selectedDictId }]"
              @click="selectDictionary(dict.id)"
            >
              <div class="dict-item-title">
                <span class="dict-item-name">{{ dict.dict_name }}</span>
                <el-tooltip
                  v-if="dict.builtin"
                  content="内置字典，不可删除"
                  placement="top"
                >
                  <el-icon class="dict-builtin"><Lock /></el-icon>
                </el-tooltip>
                <code class="dict-item-code">{{ dict.dict_code }}</code>
              </div>
              <div class="dict-item-meta">
                <el-tag :type="CATEGORY_TAG[dict.category]" size="small">
                  {{ categories.find((c) => c.value === dict.category)?.label ?? dict.category }}
                </el-tag>
                <span>{{ dict.item_count }} 项</span>
                <el-tag v-if="dict.status === 'disabled'" type="info" size="small">
                  停用
                </el-tag>
              </div>
              <div v-if="canManage" class="dict-item-actions" @click.stop>
                <el-button link type="primary" size="small" :icon="Edit" @click="openEditDict(dict)">
                  编辑
                </el-button>
                <el-button
                  link
                  type="danger"
                  size="small"
                  :icon="Delete"
                  :disabled="dict.builtin || dict.item_count > 0"
                  @click="handleDeleteDict(dict)"
                >
                  删除
                </el-button>
              </div>
            </div>
          </div>

          <div v-if="dictTotal > dictPageSize" class="dict-pager">
            <el-pagination
              v-model:current-page="dictPage"
              :page-size="dictPageSize"
              :total="dictTotal"
              layout="prev, pager, next"
              small
            />
          </div>
        </el-card>

        <!-- 右栏：字典项 -->
        <el-card shadow="never" class="dict-main">
          <template #header>
            <div class="dict-card-title">
              <span class="dict-card-name">
                {{ activeDict ? activeDict.dict_name : '字典项' }}
              </span>
              <span class="dict-card-sub">
                {{
                  activeDict
                    ? `${activeDict.dict_code} · 共 ${itemTotal} 个字典项`
                    : '请先从左侧选择一个字典'
                }}
              </span>
            </div>
          </template>
          <template v-if="activeDict && canManage" #extra>
            <el-button :icon="Upload" @click="batchModalOpen = true">批量导入</el-button>
            <el-button type="primary" :icon="Plus" @click="openCreateItem">
              新增字典项
            </el-button>
          </template>

          <el-empty
            v-if="!activeDict"
            description="从左侧选择一个字典以查看其字典项"
            :image-size="72"
          />
          <template v-else>
            <div class="dict-item-filters">
              <el-input
                v-model="itemSearchText"
                clearable
                placeholder="搜索编码或显示名称"
                class="dict-item-search"
                @keyup.enter="itemKeyword = itemSearchText"
                @clear="itemKeyword = ''"
              />
              <el-radio-group v-model="itemStatus" size="small" @change="itemPage = 1">
                <el-radio-button value="">全部</el-radio-button>
                <el-radio-button value="active">启用</el-radio-button>
                <el-radio-button value="disabled">停用</el-radio-button>
              </el-radio-group>
            </div>

            <el-table
              v-loading="itemLoading"
              :data="items"
              row-key="id"
              size="small"
              border
              stripe
            >
              <el-table-column label="编码" prop="item_code" width="160">
                <template #default="{ row }">
                  <code class="dict-code">{{ row.item_code }}</code>
                </template>
              </el-table-column>
              <el-table-column label="显示名称" prop="item_label" min-width="160" show-overflow-tooltip />
              <el-table-column label="项值" prop="item_value" width="150">
                <template #default="{ row }">
                  {{ row.item_value || '—' }}
                </template>
              </el-table-column>
              <el-table-column align="right" label="排序" prop="sort_order" width="80" />
              <el-table-column label="状态" prop="status" width="90">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
                    {{ row.status === 'active' ? '启用' : '停用' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ row.remark || '—' }}
                </template>
              </el-table-column>
              <el-table-column label="更新时间" prop="updated_at" width="150">
                <template #default="{ row }">
                  {{ fmtTime(row.updated_at) }}
                </template>
              </el-table-column>
              <el-table-column v-if="canManage" fixed="right" label="操作" width="160">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" :icon="Edit" @click="openEditItem(row)">
                    编辑
                  </el-button>
                  <el-button link type="primary" size="small" @click="handleToggleItem(row)">
                    {{ row.status === 'active' ? '停用' : '启用' }}
                  </el-button>
                  <el-button link type="danger" size="small" :icon="Delete" @click="handleDeleteItem(row)">
                    删除
                  </el-button>
                </template>
              </el-table-column>
              <template #empty>
                <el-empty description="该字典下暂无字典项" :image-size="60" />
              </template>
            </el-table>

            <div class="dict-pager">
              <el-pagination
                v-model:current-page="itemPage"
                v-model:page-size="itemPageSize"
                :page-sizes="[10, 20, 50, 100]"
                :total="itemTotal"
                layout="total, sizes, prev, pager, next"
                small
                background
              />
            </div>
          </template>
        </el-card>
      </div>
    </div>

    <!-- 新建/编辑字典 -->
    <el-dialog
      v-model="dictModalOpen"
      :title="editingDict ? '编辑字典' : '新建字典'"
      width="560"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="dictFormRef"
        :model="dictForm"
        :rules="dictRules"
        label-width="88px"
      >
        <el-form-item label="字典编码" prop="dict_code">
          <el-input
            v-model="dictForm.dict_code"
            :disabled="!!editingDict"
            placeholder="如 department"
          />
          <div class="dict-form-hint">程序引用标识，创建后不可修改</div>
        </el-form-item>
        <el-form-item label="字典名称" prop="dict_name">
          <el-input v-model="dictForm.dict_name" maxlength="128" placeholder="如 临床科室" />
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="dictForm.category">
            <el-option
              v-for="c in categories"
              :key="c.value"
              :label="c.label"
              :value="c.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="dictForm.status">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序" prop="sort_order">
          <el-input-number v-model="dictForm.sort_order" :max="9999" :min="0" />
        </el-form-item>
        <el-form-item label="说明" prop="description">
          <el-input
            v-model="dictForm.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="该字典的用途说明"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dictModalOpen = false">取消</el-button>
        <el-button type="primary" @click="submitDict">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新建/编辑字典项 -->
    <el-dialog
      v-model="itemModalOpen"
      :title="editingItem ? '编辑字典项' : '新增字典项'"
      width="560"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="itemFormRef"
        :model="itemForm"
        :rules="itemRules"
        label-width="88px"
      >
        <el-form-item label="项编码" prop="item_code">
          <el-input
            v-model="itemForm.item_code"
            :disabled="!!editingItem"
            placeholder="如 cardiology"
          />
          <div v-if="editingItem" class="dict-form-hint">编码创建后不可修改</div>
        </el-form-item>
        <el-form-item label="显示名称" prop="item_label">
          <el-input v-model="itemForm.item_label" maxlength="255" placeholder="如 心血管内科" />
        </el-form-item>
        <el-form-item label="项值" prop="item_value">
          <el-input v-model="itemForm.item_value" maxlength="255" placeholder="如 cardiology" />
          <div class="dict-form-hint">留空则默认与项编码相同</div>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="itemForm.status">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序" prop="sort_order">
          <el-input-number v-model="itemForm.sort_order" :max="9999" :min="0" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="itemForm.remark" type="textarea" :rows="2" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemModalOpen = false">取消</el-button>
        <el-button type="primary" @click="submitItem">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量导入 -->
    <el-dialog
      v-model="batchModalOpen"
      :title="`批量导入 · ${activeDict?.dict_name ?? ''}`"
      width="600"
      :close-on-click-modal="false"
    >
      <p class="dict-batch-hint">
        每行一条，格式 <code>编码,显示名,项值</code>（项值可省略，缺省同编码）。
        与已有编码重复的行会自动跳过。
      </p>
      <el-input
        v-model="batchText"
        type="textarea"
        :rows="10"
        placeholder="cardiology,心血管内科&#10;neurology,神经内科&#10;pediatrics,儿科"
      />
      <template #footer>
        <el-button @click="batchModalOpen = false">取消</el-button>
        <el-button type="primary" :disabled="!batchText.trim()" @click="submitBatch">
          导入
        </el-button>
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

.dict-layout {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

@media (width <= 1100px) {
  .dict-layout {
    grid-template-columns: 1fr;
  }
}

.dict-card-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dict-card-name {
  font-size: 15px;
  font-weight: 600;
}

.dict-card-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.dict-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.dict-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 520px;
  overflow-y: auto;
}

.dict-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease;
}

.dict-item:hover {
  background: var(--el-fill-color-light);
}

.dict-item.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.dict-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.dict-item-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dict-builtin {
  color: var(--el-color-warning);
  flex: none;
}

.dict-item-code {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  flex: none;
}

.dict-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.dict-item-actions {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

.dict-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.dict-item-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.dict-item-search {
  width: 260px;
}

.dict-code {
  font-family: var(--el-font-family-monospace, Consolas, monospace);
  font-size: 12.5px;
}

.dict-form-hint {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.dict-batch-hint {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.dict-batch-hint code {
  font-family: var(--el-font-family-monospace, Consolas, monospace);
}
</style>
