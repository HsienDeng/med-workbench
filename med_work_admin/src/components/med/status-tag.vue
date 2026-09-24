<script lang="ts" setup>
/**
 * 业务状态/类型/置信度标签（迁移自 med-work-frontend StatusTag）
 */
import { computed } from 'vue';

import { STATUS_MAP } from '#/constants/med';
import type { StatusKey } from '#/types/med';

const props = defineProps<{
  /** 状态键（review/running/done/failed/pending/in/out） */
  status: StatusKey;
}>();

/** 自定义 tag 类名 → Element Plus tag 类型 + 自定义色 */
const CLS_TO_TAG: Record<string, { color?: string; type: string }> = {
  'tag-success': { type: 'success' },
  'tag-warning': { type: 'warning' },
  'tag-error': { type: 'danger' },
  'tag-info': { type: 'primary' },
  'tag-ai': { color: '#722ed1', type: 'primary' },
  'tag-primary': { type: 'primary' },
  'tag-purple': { color: '#722ed1', type: 'primary' },
  'tag-neutral': { type: 'info' },
};

const meta = computed(() => {
  const s = STATUS_MAP[props.status] ?? STATUS_MAP.pending!;
  return CLS_TO_TAG[s.cls] ?? CLS_TO_TAG['tag-neutral']!;
});

const text = computed(() => {
  const s = STATUS_MAP[props.status] ?? STATUS_MAP.pending!;
  return s.text;
});

const tagStyle = computed(() =>
  meta.value.color
    ? {
        '--el-tag-bg-color': '#f9f0ff',
        '--el-tag-border-color': '#d3adf7',
        '--el-tag-text-color': meta.value.color,
      }
    : undefined,
);
</script>

<template>
  <el-tag :style="tagStyle" :type="meta.type" disable-transitions>
    {{ text }}
  </el-tag>
</template>
