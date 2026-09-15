/**
 * 功能权限点判断（与后端 permission_service.PERMISSION_CATALOG 一一对应）。
 *
 * 登录 / me 返回的 AuthUser.permissions 是当前账号全部有效角色权限点的并集：
 * - 菜单（DynamicMenu）决定「哪些页面可见」；
 * - 权限点决定「页面内哪些按钮 / 操作可用」，前端据此显隐，后端同样按权限点拦截。
 */
import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/app';
import type { AuthUser } from '@/types';

/** 非组件场景的权限判断（例如事件回调、工具函数） */
export function hasPermission(user: AuthUser | null | undefined, code: string): boolean {
  return (user?.permissions ?? []).includes(code);
}

/**
 * 组件内权限判断：can('patient:create')。
 * 权限集合随 store 中 user 变化自动更新（登录 / 登出 / 重新拉取用户信息）。
 */
export function usePermission() {
  const permissions = useAppStore((state) => state.user?.permissions);

  const granted = useMemo(() => new Set(permissions ?? []), [permissions]);

  return useCallback((code: string) => granted.has(code), [granted]);
}
