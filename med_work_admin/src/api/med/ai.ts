/**
 * AI 连接信息（/api/ai/*，会话页模型切换下拉用）
 */
import { requestClient } from '#/api/request';

export interface AIConnectionResponse {
  provider: string;
  display_name?: null | string;
  enabled: boolean;
  has_api_key: boolean;
  models: string[];
  active_model?: null | string;
}

export function getAiConnections() {
  return requestClient.get<AIConnectionResponse[]>('/ai/connections');
}
