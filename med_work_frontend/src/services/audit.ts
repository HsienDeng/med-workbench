/**
 * 操作审计日志接口封装（/api/audit）。
 * 仅医院管理员 / 审计员可访问（后端按角色 gate）。
 */
import { request } from './api';
import type { AuditLogListQuery, AuditLogListResponse, AuditOptionsResponse } from '@/types';

/** 审计日志分页列表（关键词 / 模块 / 操作 / 结果 / 时间范围筛选） */
export function getAuditLogs(query: AuditLogListQuery = {}): Promise<AuditLogListResponse> {
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) search.set(key, String(value));
  });
  const qs = search.toString();
  return request<AuditLogListResponse>(`/api/audit/logs${qs ? `?${qs}` : ''}`);
}

/** 审计筛选选项（模块 / 操作），保持与后端埋点值一致 */
export function getAuditOptions(): Promise<AuditOptionsResponse> {
  return request<AuditOptionsResponse>('/api/audit/options');
}
