import type {
  ActiveAIProviderResponse,
  AIConnectionResponse,
  AiProtocol,
  AiProviderCreateInput,
  AiProviderItem,
  AiProviderProbeResult,
  AiProviderUpdateInput,
  AuthUser,
  Dictionary,
  DictionaryCategory,
  DictionaryCategoryOption,
  DictionaryItem,
  DictionaryItemBatchResult,
  DictionaryItemListResponse,
  DictionaryItemPayload,
  DictionaryItemUpdatePayload,
  DictionaryListResponse,
  DictionaryOptionsResponse,
  DictionaryPayload,
  DictionaryStatus,
  DictionaryUpdatePayload,
  MenuListResponse,
} from '@/types';
import { clearAuth, loadAuth, triggerUnauthorized } from './auth-storage';
import { showGlobalError } from './global-feedback';

const API_BASE = '';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  authenticated?: boolean;
  handleUnauthorized?: boolean;
  silentError?: boolean;
  signal?: AbortSignal;
}

interface BackendErrorPayload {
  code?: string;
  message?: string;
  detail?: unknown;
  errors?: Array<{ msg?: string; message?: string }>;
}

function getDetail(payload: BackendErrorPayload) {
  if (typeof payload.detail === 'string') return payload.detail;
  if (typeof payload.message === 'string' && payload.message) return payload.message;
  return payload.errors?.[0]?.msg ?? payload.errors?.[0]?.message;
}

function getUserMessage(payload: BackendErrorPayload, status: number, hadSession: boolean) {
  const code = payload.code;
  const messages: Record<string, string> = {
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
    MED_TOKEN_MISSING: hadSession ? '登录状态已失效，请重新登录' : '请先登录',
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

  if (code && messages[code]) return messages[code];
  if (status === 401) return hadSession ? '登录状态已失效，请重新登录' : '请先登录';
  if (status === 403) return '当前账号没有执行该操作的权限';
  if (status === 404) return '请求的资源不存在';
  if (status >= 500) return '服务暂时不可用，请稍后重试';
  return getDetail(payload) || `请求失败（HTTP ${status}）`;
}

async function parsePayload(response: Response): Promise<BackendErrorPayload> {
  try {
    return (await response.json()) as BackendErrorPayload;
  } catch {
    return {};
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    authenticated = true,
    handleUnauthorized = true,
    silentError = false,
    signal,
  } = options;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  if (authenticated) {
    const token = loadAuth()?.token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const apiError = new ApiError('无法连接服务器，请确认后端服务已启动', 'MED_NETWORK_ERROR', 0);
    if (!silentError) showGlobalError(apiError);
    throw apiError;
  }

  if (!response.ok) {
    const payload = await parsePayload(response);
    const apiError = new ApiError(
      getUserMessage(payload, response.status, Boolean(loadAuth())),
      payload.code || `MED_HTTP_${response.status}`,
      response.status,
    );
    if (!silentError) showGlobalError(apiError);

    if (handleUnauthorized && authenticated && response.status === 401 && loadAuth()) {
      clearAuth();
      triggerUnauthorized();
    }
    throw apiError;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * 下载文件（GET 流式响应 → 浏览器下载）。
 * 复用 request 的鉴权头与错误处理；文件名优先取 Content-Disposition，失败用 fallbackName。
 */
export async function downloadFile(path: string, fallbackName = 'download.bin'): Promise<void> {
  const token = loadAuth()?.token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers });
  } catch {
    const apiError = new ApiError('无法连接服务器，请确认后端服务已启动', 'MED_NETWORK_ERROR', 0);
    showGlobalError(apiError);
    throw apiError;
  }

  if (!response.ok) {
    const payload = await parsePayload(response);
    const apiError = new ApiError(
      getUserMessage(payload, response.status, Boolean(loadAuth())),
      payload.code || `MED_HTTP_${response.status}`,
      response.status,
    );
    showGlobalError(apiError);
    if (response.status === 401 && loadAuth()) {
      clearAuth();
      triggerUnauthorized();
    }
    throw apiError;
  }

  const blob = await response.blob();
  let filename = fallbackName;
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const star = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) {
    filename = decodeURIComponent(star[1]);
  } else {
    const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (plain) filename = plain[1];
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface UserResponse {
  id: number;
  username: string;
  real_name: string;
  status: string;
  roles: Array<{ role_code: string; role_name: string; data_scope: string }>;
}

export function getCurrentMenus(): Promise<MenuListResponse> {
  return request<MenuListResponse>('/api/auth/menus');
}

export function getAiConnections(): Promise<AIConnectionResponse[]> {
  return request<AIConnectionResponse[]>('/api/ai/connections');
}

// ==================== AI 供应商配置（管理员） ====================

export function getAiProviders(): Promise<AiProviderItem[]> {
  return request<AiProviderItem[]>('/api/ai/providers');
}

export function createAiProvider(input: AiProviderCreateInput): Promise<AiProviderItem> {
  return request<AiProviderItem>('/api/ai/providers', { method: 'POST', body: input });
}

export function updateAiProvider(
  provider: string,
  input: AiProviderUpdateInput,
): Promise<AiProviderItem> {
  return request<AiProviderItem>(`/api/ai/providers/${encodeURIComponent(provider)}`, {
    method: 'PATCH',
    body: input,
  });
}

export function deleteAiProvider(provider: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(`/api/ai/providers/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}

export function activateAiProvider(provider: string): Promise<ActiveAIProviderResponse> {
  return request<ActiveAIProviderResponse>(
    `/api/ai/providers/${encodeURIComponent(provider)}/activate`,
    { method: 'POST' },
  );
}

export function testAiProvider(provider: string): Promise<AiProviderProbeResult> {
  return request<AiProviderProbeResult>(`/api/ai/providers/${encodeURIComponent(provider)}/test`, {
    method: 'POST',
  });
}

export function fetchAiProviderModels(provider: string): Promise<AiProviderProbeResult> {
  return request<AiProviderProbeResult>(
    `/api/ai/providers/${encodeURIComponent(provider)}/models`,
  );
}

/** 按表单草稿（协议/地址/Key）临时拉取模型列表，不落库；用于新建或改了配置未保存时。 */
export function fetchAiProviderModelsDraft(input: {
  protocol: AiProtocol;
  base_url: string;
  api_key: string;
  default_model?: string;
}): Promise<AiProviderProbeResult> {
  return request<AiProviderProbeResult>('/api/ai/providers/fetch-models', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCurrentUser(): Promise<UserResponse> {
  return request<UserResponse>('/api/auth/me');
}

export function logoutApi(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', silentError: true });
}

// ==================== 数据字典 ====================

export interface DictionaryQuery {
  keyword?: string;
  category?: DictionaryCategory;
  status?: DictionaryStatus;
  page?: number;
  pageSize?: number;
}

export interface DictionaryItemQuery {
  keyword?: string;
  status?: DictionaryStatus;
  page?: number;
  pageSize?: number;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** 字典分类枚举（前端筛选器用） */
export function getDictionaryCategories(): Promise<DictionaryCategoryOption[]> {
  return request<DictionaryCategoryOption[]>('/api/dictionaries/categories');
}

/** 按编码取启用中的选项，供其它页面下拉复用 */
export function getDictionaryOptions(dictCode: string): Promise<DictionaryOptionsResponse> {
  return request<DictionaryOptionsResponse>(`/api/dictionaries/options/${encodeURIComponent(dictCode)}`);
}

export function getDictionaries(query: DictionaryQuery = {}): Promise<DictionaryListResponse> {
  return request<DictionaryListResponse>(
    `/api/dictionaries${buildQuery({
      keyword: query.keyword,
      category: query.category,
      status: query.status,
      page: query.page,
      page_size: query.pageSize,
    })}`,
  );
}

export function createDictionary(payload: DictionaryPayload): Promise<Dictionary> {
  return request<Dictionary>('/api/dictionaries', { method: 'POST', body: payload });
}

export function updateDictionary(id: number, payload: DictionaryUpdatePayload): Promise<Dictionary> {
  return request<Dictionary>(`/api/dictionaries/${id}`, { method: 'PATCH', body: payload });
}

export function deleteDictionary(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/dictionaries/${id}`, { method: 'DELETE' });
}

export function getDictionaryItems(
  dictId: number,
  query: DictionaryItemQuery = {},
): Promise<DictionaryItemListResponse> {
  return request<DictionaryItemListResponse>(
    `/api/dictionaries/${dictId}/items${buildQuery({
      keyword: query.keyword,
      status: query.status,
      page: query.page,
      page_size: query.pageSize,
    })}`,
  );
}

export function createDictionaryItem(dictId: number, payload: DictionaryItemPayload): Promise<DictionaryItem> {
  return request<DictionaryItem>(`/api/dictionaries/${dictId}/items`, { method: 'POST', body: payload });
}

/** 批量导入：每行 `编码,显示名[,值]` */
export function batchCreateDictionaryItems(dictId: number, text: string): Promise<DictionaryItemBatchResult> {
  return request<DictionaryItemBatchResult>(`/api/dictionaries/${dictId}/items/batch`, {
    method: 'POST',
    body: { text },
  });
}

export function updateDictionaryItem(
  itemId: number,
  payload: DictionaryItemUpdatePayload,
): Promise<DictionaryItem> {
  return request<DictionaryItem>(`/api/dictionaries/items/${itemId}`, { method: 'PATCH', body: payload });
}

export function deleteDictionaryItem(itemId: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/dictionaries/items/${itemId}`, { method: 'DELETE' });
}
