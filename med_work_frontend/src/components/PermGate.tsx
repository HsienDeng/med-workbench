/**
 * 权限点闸门组件：无权限时不渲染子节点（可选 fallback 用于展示禁用态按钮）。
 *
 * 用法：
 *   <PermGate code="patient:delete">
 *     <Button danger>删除</Button>
 *   </PermGate>
 */
import type { ReactNode } from 'react';
import { usePermission } from '@/utils/access';

interface PermGateProps {
  /** 功能权限点编码，例如 patient:create */
  code: string;
  /** 无权限时的替代内容（默认不渲染） */
  fallback?: ReactNode;
  children: ReactNode;
}

export default function PermGate({ code, fallback = null, children }: PermGateProps) {
  const can = usePermission();
  return <>{can(code) ? children : fallback}</>;
}
