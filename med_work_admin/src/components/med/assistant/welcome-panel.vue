<script lang="ts" setup>
/**
 * AI 助手欢迎页：问候语 + 4 能力卡片 + 建议问题（点击回填到输入框）。
 * 迁移自 med-work-frontend Assistant 空态布局。
 */
import { ArrowRight, ChatLineRound, MagicStick } from '@element-plus/icons-vue';

import CapabilityIcons from './capability-icons.vue';

interface Capability {
  description: string;
  key: 'data' | 'knowledge' | 'record' | 'retrieval';
  prompt: string;
  theme: 'green' | 'orange' | 'purple' | 'blue';
  title: string;
}

const CAPABILITIES: Capability[] = [
  {
    description: '疾病诊疗、药品说明与临床指南查询',
    key: 'knowledge',
    prompt: '高血压患者常见的用药注意事项有哪些？',
    theme: 'blue',
    title: '医学知识问答',
  },
  {
    description: '梳理病历内容，辅助识别关键信息',
    key: 'record',
    prompt: '请分析这份病历并给出可能的诊断方向',
    theme: 'green',
    title: '病历智能分析',
  },
  {
    description: '检索本机构资料与医学知识库',
    key: 'retrieval',
    prompt: '查询阿司匹林与华法林的相互作用',
    theme: 'purple',
    title: '知识库检索',
  },
  {
    description: '归纳指标变化，提炼可读结论',
    key: 'data',
    prompt: '帮我总结最新的临床指标要点',
    theme: 'orange',
    title: '数据分析',
  },
];

defineProps<{
  /** 头像图片 URL（可空，使用首字母 fallback） */
  avatar?: string;
  /** 工作台名（默认 MedAI） */
  name?: string;
  /** 欢迎语 */
  subtitle?: string;
}>();

const emit = defineEmits<{
  (e: 'pick', prompt: string): void;
}>();

function pick(prompt: string) {
  emit('pick', prompt);
}
</script>

<template>
  <div class="med-assistant-welcome">
    <div class="med-assistant-greet">
      <div v-if="avatar" class="med-assistant-avatar">
        <img :src="avatar" alt="" />
      </div>
      <div v-else class="med-assistant-avatar med-assistant-avatar--fallback">
        <el-icon><MagicStick /></el-icon>
      </div>
      <h1>你好，我是{{ name ?? 'MedAI' }}</h1>
      <p>{{ subtitle ?? '基于医疗知识库的智能助手，帮助你快速获取专业信息、分析病历、辅助决策。' }}</p>
    </div>

    <div class="med-assistant-capability-grid" aria-label="对话能力">
      <button
        v-for="item in CAPABILITIES"
        :key="item.key"
        type="button"
        :class="['med-capability', `med-capability--${item.theme}`]"
        @click="pick(item.prompt)"
      >
        <span class="med-capability-icon" aria-hidden="true">
          <CapabilityIcons :name="item.key" />
        </span>
        <span class="med-capability-copy">
          <strong>{{ item.title }}</strong>
          <span>{{ item.description }}</span>
        </span>
        <el-icon class="med-capability-arrow" aria-hidden="true">
          <ArrowRight />
        </el-icon>
      </button>
    </div>

    <section class="med-assistant-suggestions" aria-label="建议问题">
      <div class="med-assistant-suggestions-title">
        <el-icon><ChatLineRound /></el-icon>
        <span>你可以这样问我</span>
      </div>
      <div class="med-assistant-suggestion-list">
        <button
          v-for="item in CAPABILITIES"
          :key="`s-${item.key}`"
          type="button"
          @click="pick(item.prompt)"
        >
          <span>{{ item.prompt }}</span>
          <el-icon aria-hidden="true"><ArrowRight /></el-icon>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.med-assistant-welcome {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(100%, 980px);
  margin: 0 auto;
}

.med-assistant-greet {
  text-align: center;
}

.med-assistant-avatar {
  width: 64px;
  height: 64px;
  margin: 0 auto 14px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: 0 8px 20px rgb(45 108 223 / 18%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.med-assistant-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.med-assistant-avatar--fallback {
  background: linear-gradient(135deg, #2d6cdf, #7653d6);
  color: #fff;
  font-size: 28px;
}

.med-assistant-greet h1 {
  margin: 0 0 8px;
  color: #1b2537;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.25;
}

.med-assistant-greet p {
  max-width: 660px;
  margin: 0 auto;
  color: #596780;
  font-size: 14px;
  line-height: 1.7;
}

.med-assistant-capability-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

@media (width <= 1180px) {
  .med-assistant-capability-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width <= 767px) {
  .med-assistant-capability-grid {
    grid-template-columns: 1fr;
  }
}

.med-capability {
  --capability-color: #2d6cdf;
  --capability-bg: #eff5ff;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 132px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid #e4e9f2;
  border-radius: 10px;
  background: #fff;
  color: #1b2537;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.med-capability:hover {
  border-color: color-mix(in srgb, var(--capability-color) 38%, #e4e9f2);
  box-shadow: 0 10px 24px rgb(31 51 84 / 9%);
  transform: translateY(-2px);
}

.med-capability--green {
  --capability-color: #0b8f7f;
  --capability-bg: #e9f8f4;
}

.med-capability--purple {
  --capability-color: #7653d6;
  --capability-bg: #f2effc;
}

.med-capability--orange {
  --capability-color: #c56a1a;
  --capability-bg: #fff3e9;
}

.med-capability-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-bottom: 12px;
  border-radius: 8px;
  background: var(--capability-bg);
  color: var(--capability-color);
  font-size: 18px;
}

.med-capability-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 18px;
}

.med-capability-copy strong {
  font-size: 14px;
  line-height: 20px;
}

.med-capability-copy > span {
  color: #65728a;
  font-size: 12px;
  line-height: 18px;
}

.med-capability-arrow {
  position: absolute;
  right: 14px;
  bottom: 16px;
  color: var(--capability-color);
  font-size: 12px;
  transition: transform 160ms ease;
}

.med-capability:hover .med-capability-arrow {
  transform: translateX(3px);
}

.med-assistant-suggestions {
  margin-top: 18px;
}

.med-assistant-suggestions-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: #31415d;
  font-size: 13px;
  font-weight: 600;
}

.med-assistant-suggestions-title .el-icon {
  color: #2d6cdf;
}

.med-assistant-suggestion-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.med-assistant-suggestion-list button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid #dce5f2;
  border-radius: 999px;
  background: rgb(255 255 255 / 82%);
  color: #38557f;
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.med-assistant-suggestion-list button:hover {
  border-color: #a9c3ef;
  background: #fff;
}

.med-assistant-suggestion-list button .el-icon {
  flex: none;
  color: #7893bc;
  font-size: 10px;
}
</style>
