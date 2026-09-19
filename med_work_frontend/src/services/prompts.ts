/**
 * 提示词模板服务：系统预设（全局共享、只读）+ 用户自建模板。
 */
import { loadAuth } from './auth-storage';

export interface PromptTemplate {
  id: number;
  name: string;
  description?: string | null;
  content: string;
  is_preset: boolean;
  sort_order: number;
  updated_at?: string | null;
}

export interface PromptInput {
  name: string;
  description?: string;
  content: string;
}

/** 带鉴权的 JSON 请求封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = loadAuth()?.token;
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const payload = (await res.json()) as { message?: string; detail?: string };
      message = payload.message || payload.detail || message;
    } catch {
      /* 响应体非 JSON，沿用默认文案 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** 模板列表：预设在前，自建在后 */
export const listPrompts = () => request<PromptTemplate[]>('/api/prompts');

/** 新建个人模板 */
export const createPrompt = (input: PromptInput) =>
  request<PromptTemplate>('/api/prompts', {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** 更新个人模板 */
export const updatePrompt = (id: number, input: Partial<PromptInput>) =>
  request<PromptTemplate>(`/api/prompts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

/** 删除个人模板（软删） */
export const deletePrompt = (id: number) =>
  request<{ ok: boolean }>(`/api/prompts/${id}`, { method: 'DELETE' });
