import { Tag } from 'antd';
import { STATUS_MAP, TYPE_CLS_MAP, CONFIDENCE_THRESHOLD } from '@/constants';
import type { StatusKey } from '@/types';

export type { StatusKey };

/** 自定义 tag 类名 → antd preset 颜色 */
const CLS_TO_COLOR: Record<string, string> = {
  'tag-success': 'success',
  'tag-warning': 'warning',
  'tag-error': 'error',
  'tag-info': 'blue',
  'tag-ai': 'purple',
  'tag-primary': 'blue',
  'tag-purple': 'purple',
  'tag-neutral': 'default',
};

function toColor(cls: string): string {
  return CLS_TO_COLOR[cls] ?? 'default';
}

/** 业务状态标签 */
export default function StatusTag({ status }: { status: StatusKey }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <Tag color={toColor(s.cls)} style={{ marginInlineEnd: 0 }}>
      {s.text}
    </Tag>
  );
}

/** 状态标签（别名，兼容历史引用） */
export function StatusBadge({ status }: { status: StatusKey }) {
  return <StatusTag status={status} />;
}

/** 业务类型标签 */
export function TypeTag({ type }: { type: string }) {
  return (
    <Tag color={toColor(TYPE_CLS_MAP[type] ?? 'tag-neutral')} style={{ marginInlineEnd: 0 }}>
      {type}
    </Tag>
  );
}

/** 置信度标签 */
export function ConfidenceCell({ value }: { value: number }) {
  const cls =
    value >= CONFIDENCE_THRESHOLD.high
      ? 'tag-success'
      : value >= CONFIDENCE_THRESHOLD.medium
        ? 'tag-info'
        : 'tag-warning';
  return (
    <Tag color={toColor(cls)} style={{ marginInlineEnd: 0 }}>
      {value}%
    </Tag>
  );
}
