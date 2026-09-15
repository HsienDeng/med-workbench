/**
 * 账号管理接口封装（/api/accounts）。
 */
import { request } from './api';
import type {
  AccountBatchImportResult,
  AccountCreateResult,
  AccountItem,
  AccountListQuery,
  AccountListResponse,
  AccountOptions,
  AccountPayload,
  AccountResetResult,
  AccountStatus,
  AccountUpdatePayload,
} from '@/types';

function buildQuery(params: AccountListQuery): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** 账号分页列表（关键词 / 状态 / 角色 / 科室筛选） */
export function getAccounts(query: AccountListQuery = {}): Promise<AccountListResponse> {
  return request<AccountListResponse>(`/api/accounts${buildQuery(query)}`);
}

/** 账号管理页下拉数据：启用角色 + 启用科室 */
export function getAccountOptions(): Promise<AccountOptions> {
  return request<AccountOptions>('/api/accounts/options');
}

/** 新建账号：返回一次性明文初始密码 */
export function createAccount(payload: AccountPayload): Promise<AccountCreateResult> {
  return request<AccountCreateResult>('/api/accounts', { method: 'POST', body: payload });
}

/** 更新账号基础资料与角色分配 */
export function updateAccount(
  id: number,
  payload: AccountUpdatePayload,
): Promise<AccountItem> {
  return request<AccountItem>(`/api/accounts/${id}`, { method: 'PATCH', body: payload });
}

/** 删除账号（软删除，即时失效会话） */
export function deleteAccount(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' });
}

/** 变更账号状态：启用 / 停用 / 锁定 / 待启用 */
export function setAccountStatus(id: number, status: AccountStatus): Promise<AccountItem> {
  return request<AccountItem>(`/api/accounts/${id}/status`, {
    method: 'POST',
    body: { status },
  });
}

/** 重置密码：password 留空由后端自动生成；返回一次性明文新密码 */
export function resetAccountPassword(
  id: number,
  password?: string | null,
): Promise<AccountResetResult> {
  return request<AccountResetResult>(`/api/accounts/${id}/reset-password`, {
    method: 'POST',
    body: { password: password ?? null },
  });
}

/** 文本批量导入账号，返回成功数与失败明细 */
export function batchImportAccounts(text: string): Promise<AccountBatchImportResult> {
  return request<AccountBatchImportResult>('/api/accounts/batch-import', {
    method: 'POST',
    body: { text },
  });
}
