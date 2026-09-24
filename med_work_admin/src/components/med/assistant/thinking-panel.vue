<script lang="ts" setup>
/**
 * 助手消息上方的推理过程折叠面板（迁移自 med-work-frontend ThinkingPanel）。
 * 模型/网关支持时展示，生成中自动展开。
 */
import { Loading, MagicStick } from '@element-plus/icons-vue';

defineProps<{
  /** 推理全文（增量累积） */
  text: string;
  /** 是否正在生成（用于自动展开 + 角标） */
  active?: boolean;
}>();
</script>

<template>
  <details class="med-thinking" :open="active">
    <summary>
      <el-icon aria-hidden="true"><MagicStick /></el-icon>
      <span class="med-thinking-title">思考过程</span>
      <span v-if="active" class="med-thinking-live">
        <el-icon class="is-loading"><Loading /></el-icon>
        思考中
      </span>
    </summary>
    <div class="med-thinking-body">{{ text }}</div>
  </details>
</template>

<style scoped>
.med-thinking {
  margin-bottom: 10px;
  border: 1px solid #dce6f5;
  border-radius: 8px;
  background: rgb(45 108 223 / 4%);
  font-size: 13px;
  overflow: hidden;
}

.med-thinking summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  color: #6b7a90;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.med-thinking summary::-webkit-details-marker {
  display: none;
}

.med-thinking-title {
  font-weight: 600;
}

.med-thinking-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #2d6cdf;
  font-size: 12px;
}

.med-thinking-body {
  padding: 4px 10px 10px;
  color: #6b7a90;
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow-y: auto;
}
</style>
