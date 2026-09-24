<script lang="ts" setup>
/**
 * 提示词管理页（迁移自 med-work-frontend Prompts）：
 * 管理 AI 聊天的内置助手与个人提示词（Skill）模板。
 * 卡片网格 + 编辑弹窗，与 Assistant 内的管理弹窗共用 PromptManagePanel。
 */
import PageHead from '#/components/med/page-head.vue';
import PromptManagePanel from '#/components/med/prompt-manage-panel.vue';
</script>

<template>
  <div class="med-page">
    <div class="med-page-inner">
      <PageHead
        :crumbs="[{ label: '智能诊疗中心' }, { label: '提示词管理', current: true }]"
        title="提示词管理"
        subtitle="维护 AI 聊天可用的内置助手与个人提示词，新建会话时在输入区工具栏选用"
      />
      <el-card shadow="never">
        <PromptManagePanel :modal-width="680" />
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.med-page {
  height: 100%;
  padding: 20px;
  overflow-y: auto;
  background: var(--el-fill-color-lighter);
}

.med-page-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
