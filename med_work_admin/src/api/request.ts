/**
 * med_work_backend 请求层
 *
 * 后端约定（与 med-work-frontend 的 src/services/api.ts 保持一致）：
 * - 成功：HTTP 2xx/3xx，响应体即数据本体（无 code/data 包装）
 * - 失败：HTTP 4xx/5xx，响应体 { code: 'MED_*', message, detail? }
 * - 鉴权：Bearer Token（session 型，无 refresh token，401 统一登出）
 */
import type { RequestClientOptions } from '@vben/request';

import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  authenticateResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
} from '@vben/request';
import { useAccessStore } from '@vben/stores';

import { ElMessage } from 'element-plus';

import { useAuthStore } from '#/store';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/** MED_* 错误码 → 中文提示（移植自 med-work-frontend src/services/api.ts） */
const MED_ERROR_MESSAGES: Record<string, string> = {
  MED_CREDENTIALS_INVALID: '账号或密码错误',
  MED_ACCOUNT_LOCKED: '登录尝试过多，账号已暂时锁定',
  MED_ACCOUNT_DISABLED: '账号已停用，请联系管理员',
  MED_ACCOUNT_PENDING: '账号待启用，请联系管理员',
  MED_ACCOUNT_ALREADY_EXISTS: '该账号已存在',
  MED_ACCOUNT_EMPLOYEE_NO_EXISTS: '该工号已被其他账号使用',
  MED_ACCOUNT_SELF_LOCKOUT: '不能对当前登录账号执行该操作，防止管理员账号被锁死',
  MED_ROLE_CODE_EXISTS: '该角色编码已存在',
  MED_ROLE_NAME_EXISTS: '该角色名称已存在',
  MED_ROLE_SYSTEM_PROTECTED: '系统内置角色受保护，仅可修改说明',
  MED_TOKEN_MISSING: '登录状态已失效，请重新登录',
  MED_SESSION_EXPIRED: '登录已过期，请重新登录',
  MED_AI_PROVIDER_NOT_CONFIGURED: 'AI 服务尚未配置，请联系管理员',
  MED_REDIS_UNAVAILABLE: '缓存服务暂不可用，请稍后重试',
  MED_AI_UPSTREAM_UNAVAILABLE: 'AI 服务暂不可用，请稍后重试',
  MED_REQUEST_VALIDATION_FAILED: '提交的数据不完整或有误，请检查后重试',
  MED_DOC_TYPE_UNSUPPORTED: '暂不支持该文件格式',
  MED_DOC_TOO_LARGE: '文件超出大小上限',
  MED_DOC_EMPTY: '文件内容为空，无法识别',
  MED_DOC_PARSE_FAILED: '文件解析失败，请检查内容或更换文件',
  MED_SEARCH_EMPTY: '检索关键词不能为空',
};

function createRequestClient(baseURL: string, options?: RequestClientOptions) {
  const client = new RequestClient({
    ...options,
    baseURL,
  });

  /**
   * 重新认证逻辑：med 后端无 refresh token，401 一律清空令牌并回登录页
   */
  async function doReAuthenticate() {
    console.warn('Access token is invalid or expired.');
    const accessStore = useAccessStore();
    const authStore = useAuthStore();
    accessStore.setAccessToken(null);
    await authStore.logout();
  }

  function formatToken(token: null | string) {
    return token ? `Bearer ${token}` : null;
  }

  // 请求头处理：附加 Bearer Token 与语言
  client.addRequestInterceptor({
    fulfilled: async (config) => {
      const accessStore = useAccessStore();

      config.headers.Authorization = formatToken(accessStore.accessToken);
      config.headers['Accept-Language'] = preferences.app.locale;
      return config;
    },
  });

  // med 后端直接返回数据本体，去掉 vben 默认的 code/data 包装解包
  client.addResponseInterceptor({
    fulfilled: (response) => {
      if (response.config.responseReturn === 'raw') {
        return response;
      }
      return response.data;
    },
  });

  // token 过期/失效的处理（无 refresh token）
  client.addResponseInterceptor(
    authenticateResponseInterceptor({
      client,
      doReAuthenticate,
      doRefreshToken: async () => {
        await doReAuthenticate();
        return '';
      },
      enableRefreshToken: false,
      formatToken,
    }),
  );

  // 通用错误提示：优先 MED_* 错误码映射，其次 message/detail/error 字段
  client.addResponseInterceptor(
    errorMessageResponseInterceptor((msg: string, error) => {
      const responseData = error?.response?.data ?? {};
      const code = responseData?.code as string | undefined;
      const message =
        MED_ERROR_MESSAGES[code ?? ''] ??
        (responseData?.message as string | undefined) ??
        (responseData?.detail as string | undefined) ??
        (responseData?.error as string | undefined) ??
        '';
      // 401 已由重新登录流程处理（跳转登录页），这里不再重复弹错
      if (error?.response?.status === 401) return;
      ElMessage.error(message || msg);
    }),
  );

  return client;
}

export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'body',
});

/** 无拦截器的裸客户端（登出等场景使用） */
export const baseRequestClient = new RequestClient({ baseURL: apiURL });
