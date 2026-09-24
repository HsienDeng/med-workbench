<script lang="ts" setup>
/**
 * 页头（迁移自 med-work-frontend PageHead）：面包屑 + 标题 + 副标题 + 右侧操作区
 */
defineProps<{
  /** 面包屑 */
  crumbs?: Array<{ current?: boolean; label: string }>;
  /** 紧凑模式：缩小标题字号与间距，适用于满高工作台页面 */
  dense?: boolean;
  /** 副标题 */
  subtitle?: string;
  /** 标题 */
  title: string;
}>();
</script>

<template>
  <div class="page-head" :class="{ dense }">
    <div class="page-head-main">
      <el-breadcrumb v-if="crumbs?.length" separator="/">
        <el-breadcrumb-item v-for="(crumb, index) in crumbs" :key="index">
          {{ crumb.label }}
        </el-breadcrumb-item>
      </el-breadcrumb>
      <div class="page-head-title" :class="{ dense }">{{ title }}</div>
      <div v-if="subtitle" class="page-head-subtitle">{{ subtitle }}</div>
    </div>
    <div v-if="$slots.actions" class="page-head-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.page-head-main {
  flex: 1;
  min-width: 0;
}

.page-head-title {
  margin: 6px 0 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}

.page-head-title.dense {
  margin-top: 2px;
  font-size: 16px;
}

.page-head-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.page-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
