/**
 * 权限管理（角色）接口封装（/api/roles）。
 */
import type {
  RoleDetailItem,
  RoleListQuery,
  RoleListResponse,
  RoleMenuTreeNode,
  RolePayload,
  RolePermissionTreeNode,
  RoleStatus,
  RoleUpdatePayload,
} from '#/types/med';

import { cleanQuery, patchRequest } from '#/api/med/_utils';
import { requestClient } from '#/api/request';

/** 角色分页列表（关键词 / 状态筛选） */
export function getRoles(query: RoleListQuery = {}) {
  return requestClient.get<RoleListResponse>('/roles', {
    params: cleanQuery(query),
  });
}

/** 全部启用菜单组成的授权树 */
export function getRoleMenuTree() {
  return requestClient.get<{ items: RoleMenuTreeNode[] }>('/roles/menus');
}

/** 全部功能权限点按模块分组组成的授权树 */
export function getRolePermissionTree() {
  return requestClient.get<{ items: RolePermissionTreeNode[] }>(
    '/roles/permission-tree',
  );
}

/** 角色详情（含已授权菜单 key） */
export function getRole(id: number) {
  return requestClient.get<RoleDetailItem>(`/roles/${id}`);
}

/** 新建角色并配置菜单授权 */
export function createRole(payload: RolePayload) {
  return requestClient.post<RoleDetailItem>('/roles', payload);
}

/** 更新角色资料与菜单授权 */
export function updateRole(id: number, payload: RoleUpdatePayload) {
  return patchRequest<RoleDetailItem>(`/roles/${id}`, payload);
}

/** 启用 / 停用角色 */
export function setRoleStatus(id: number, status: RoleStatus) {
  return requestClient.post<RoleDetailItem>(`/roles/${id}/status`, { status });
}

/** 删除角色（软删除；仍有成员时后端拒绝） */
export function deleteRole(id: number) {
  return requestClient.delete<{ ok: boolean }>(`/roles/${id}`);
}
