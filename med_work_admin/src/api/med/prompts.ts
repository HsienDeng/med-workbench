/**
 * 提示词模板服务（/api/prompts）：系统预设（全局共享、只读）+ 用户自建模板。
 */
import { requestClient } from '#/api/request';

export interface PromptTemplate {
  id: number;
  name: string;
  description?: null | string;
  content: string;
  is_preset: boolean;
  sort_order: number;
  updated_at?: null | string;
}

export interface PromptInput {
  content: string;
  description?: string;
  name: string;
}

/** 模板列表：预设在前，自建在后 */
export function listPrompts() {
  return requestClient.get<PromptTemplate[]>('/prompts');
}

/** 新建个人模板 */
export function createPrompt(input: PromptInput) {
  return requestClient.post<PromptTemplate>('/prompts', input);
}

/** 更新个人模板 */
export function updatePrompt(id: number, input: Partial<PromptInput>) {
  return requestClient.put<PromptTemplate>(`/prompts/${id}`, input);
}

/** 删除个人模板（软删） */
export function deletePrompt(id: number) {
  return requestClient.delete<{ ok: boolean }>(`/prompts/${id}`);
}
