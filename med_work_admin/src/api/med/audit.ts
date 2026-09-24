/**
 * 操作审计日志接口封装（/api/audit）。
 * 仅医院管理员 / 审计员可访问（后端按角色 gate）。
 */
import type {
  AuditLogListQuery,
  AuditLogListResponse,
  AuditOptionsResponse,
} from '#/types/med';

import { cleanQuery } from '#/api/med/_utils';
import { requestClient } from '#/api/request';

/** 审计日志分页列表（关键词 / 模块 / 操作 / 结果 / 时间范围筛选） */
export function getAuditLogs(query: AuditLogListQuery = {}) {
  return requestClient.get<AuditLogListResponse>('/audit/logs', {
    params: cleanQuery(query),
  });
}

/** 审计筛选选项（模块 / 操作），保持与后端埋点值一致 */
export function getAuditOptions() {
  return requestClient.get<AuditOptionsResponse>('/audit/options');
}
