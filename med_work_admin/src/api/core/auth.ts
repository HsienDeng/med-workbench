/**
 * med_work_backend 认证接口（/api/auth/*）
 */
import type { MedUserOut } from '#/types/med/user';

import { useAccessStore } from '@vben/stores';

import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数（vben 登录表单 username 映射为后端 account） */
  export interface LoginParams {
    password?: string;
    username?: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
    user: MedUserOut;
  }
}

interface MedLoginResponse {
  token: string;
  user: MedUserOut;
}

/**
 * 登录：POST /api/auth/login { account, password } → { token, user }
 */
export async function loginApi(data: AuthApi.LoginParams) {
  const result = await requestClient.post<MedLoginResponse>('/auth/login', {
    account: data.username,
    password: data.password,
  });
  return {
    accessToken: result.token,
    user: result.user,
  } satisfies AuthApi.LoginResult;
}

/**
 * 退出登录（走 baseRequestClient 手动附加令牌，避免 401 时触发重新登录递归）
 */
export async function logoutApi() {
  const accessStore = useAccessStore();
  const token = accessStore.accessToken;
  return baseRequestClient.post<void>(
    '/auth/logout',
    {},
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
}

/**
 * 获取用户权限码：GET /api/auth/me → permissions（各角色权限点并集）
 */
export async function getAccessCodesApi() {
  const user = await requestClient.get<MedUserOut>('/auth/me');
  return user.permissions ?? [];
}
