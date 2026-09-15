/**
 * 全局常量
 */
import type { StatusKey } from '@/types';

/** 状态 → 文案 / 样式类映射 */
export const STATUS_MAP: Record<StatusKey, { text: string; cls: string }> = {
  review: { text: '待审核', cls: 'tag-warning' },
  running: { text: '进行中', cls: 'tag-info' },
  done: { text: '已完成', cls: 'tag-success' },
  failed: { text: '失败', cls: 'tag-error' },
  pending: { text: '待执行', cls: 'tag-neutral' },
  in: { text: '住院中', cls: 'tag-primary' },
  out: { text: '已出院', cls: 'tag-neutral' },
};

/** 业务类型 → 样式类映射（文档 / 分析类型共用） */
export const TYPE_CLS_MAP: Record<string, string> = {
  // 短标签（历史兼容）
  指南: 'tag-primary',
  文献: 'tag-purple',
  药品: 'tag-ai',
  规范: 'tag-info',
  病例: 'tag-success',
  // 字典完整标签（doc_type 由字典维护后 TypeTag 直接展示）
  临床指南: 'tag-primary',
  医学文献: 'tag-purple',
  药品说明书: 'tag-ai',
  院内规范: 'tag-info',
  疑难病例: 'tag-success',
  // 分析类型
  病历结构化: 'tag-primary',
  病历智能分析: 'tag-purple',
  用药风险筛查: 'tag-ai',
  知识检索: 'tag-info',
};

/** 置信度阈值 */
export const CONFIDENCE_THRESHOLD = {
  high: 90,
  medium: 85,
} as const;

/** 一期开放模块 */
export const PHASE1_PAGES = [
  'dashboard',
  'analysis',
  'patients',
  'documents',
] as const;
