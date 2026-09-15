/**
 * 权限管理（角色）接口封装（/api/roles）。
 */
import { request } from './api';
import type {
  RoleDetailItem,
  RoleItem,
  RoleListQuery,
  RoleListResponse,
  RoleMenuTreeNode,
  RolePayload,
  RolePermissionTreeNode,
  RoleStatus,
  RoleUpdatePayload,
} from '@/types';

function buildQuery(params: RoleListQuery): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** 角色分页列表（关键词 / 状态筛选） */
export function getRoles(query: RoleListQuery = {}): Promise<RoleListResponse> {
  return request<RoleListResponse>(`/api/roles${buildQuery(query)}`);
}

/** 全部启用菜单组成的授权树 */
export function getRoleMenuTree(): Promise<{ items: RoleMenuTreeNode[] }> {
  return request<{ items: RoleMenuTreeNode[] }>('/api/roles/menus');
}

/** 全部功能权限点按模块分组组成的授权树 */
export function getRolePermissionTree(): Promise<{ items: RolePermissionTreeNode[] }> {
  return request<{ items: RolePermissionTreeNode[] }>('/api/roles/permission-tree');
}

/** 角色详情（含已授权菜单 key） */
export function getRole(id: number): Promise<RoleDetailItem> {
  return request<RoleDetailItem>(`/api/roles/${id}`);
}

/** 新建角色并配置菜单授权 */
export function createRole(payload: RolePayload): Promise<RoleDetailItem> {
  return request<RoleDetailItem>('/api/roles', { method: 'POST', body: payload });
}

/** 更新角色资料与菜单授权 */
export function updateRole(id: number, payload: RoleUpdatePayload): Promise<RoleDetailItem> {
  return request<RoleDetailItem>(`/api/roles/${id}`, { method: 'PATCH', body: payload });
}

/** 启用 / 停用角色 */
export function setRoleStatus(id: number, status: RoleStatus): Promise<RoleDetailItem> {
  return request<RoleDetailItem>(`/api/roles/${id}/status`, {
    method: 'POST',
    body: { status },
  });
}

/** 删除角色（软删除；仍有成员时后端拒绝） */
export function deleteRole(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/roles/${id}`, { method: 'DELETE' });
}
