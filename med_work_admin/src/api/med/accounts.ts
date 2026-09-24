/**
 * 账号管理接口封装（/api/accounts）。
 */
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
} from '#/types/med';

import { patchRequest } from '#/api/med/_utils';
import { requestClient } from '#/api/request';

/** 账号分页列表（关键词 / 状态 / 角色 / 科室筛选） */
export function getAccounts(query: AccountListQuery = {}) {
  return requestClient.get<AccountListResponse>('/accounts', { params: query });
}

/** 账号管理页下拉数据：启用角色 + 启用科室 */
export function getAccountOptions() {
  return requestClient.get<AccountOptions>('/accounts/options');
}

/** 新建账号：返回一次性明文初始密码 */
export function createAccount(payload: AccountPayload) {
  return requestClient.post<AccountCreateResult>('/accounts', payload);
}

/** 更新账号基础资料与角色分配 */
export function updateAccount(id: number, payload: AccountUpdatePayload) {
  return patchRequest<AccountItem>(`/accounts/${id}`, payload);
}

/** 删除账号（软删除，即时失效会话） */
export function deleteAccount(id: number) {
  return requestClient.delete<{ ok: boolean }>(`/accounts/${id}`);
}

/** 变更账号状态：启用 / 停用 / 锁定 / 待启用 */
export function setAccountStatus(id: number, status: AccountStatus) {
  return requestClient.post<AccountItem>(`/accounts/${id}/status`, { status });
}

/** 重置密码：password 留空由后端自动生成；返回一次性明文新密码 */
export function resetAccountPassword(id: number, password?: null | string) {
  return requestClient.post<AccountResetResult>(
    `/accounts/${id}/reset-password`,
    { password: password ?? null },
  );
}

/** 文本批量导入账号，返回成功数与失败明细 */
export function batchImportAccounts(text: string) {
  return requestClient.post<AccountBatchImportResult>(
    '/accounts/batch-import',
    { text },
  );
}
