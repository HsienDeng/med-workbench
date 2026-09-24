import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';
import type { MedUserOut } from '#/types/med/user';

/**
 * 获取当前用户信息：GET /api/auth/me
 *
 * 映射约定（关键）：UserInfo.roles 填充的是权限点（permissions），
 * 供 vben frontend 访问模式按路由 meta.authority 过滤菜单；
 * 按钮级权限仍通过 accessCodes（getAccessCodesApi）控制。
 */
export async function getUserInfoApi(): Promise<UserInfo> {
  const user = await requestClient.get<MedUserOut>('/auth/me');
  return {
    avatar: '',
    desc: user.roles.map((role) => role.role_name).join('、'),
    homePath: '/assistant',
    realName: user.real_name,
    roles: user.permissions ?? [],
    token: '',
    userId: String(user.id),
    username: user.username,
  };
}
