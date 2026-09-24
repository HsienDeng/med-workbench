/**
 * med 服务层内部工具。
 */
import { requestClient } from '#/api/request';

/**
 * PATCH 请求辅助：requestClient 未内置 patch 快捷方法，
 * 通过通用 request 方法显式指定 method 发送。
 */
export function patchRequest<T>(url: string, data?: unknown): Promise<T> {
  return requestClient.request<T>(url, { data, method: 'PATCH' });
}

/**
 * 清洗查询参数：丢弃 undefined / null / 空字符串。
 * 与源项目 buildQuery 的过滤行为一致（axios 默认只丢弃 undefined/null，
 * 空字符串会以 `key=` 形式下发，而空串在源语义里表示「全部」不能下发）。
 */
export function cleanQuery(params: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    result[key] = value;
  }
  return result;
}

/** FormData 上传的请求头（覆盖实例默认的 JSON Content-Type，axios 会自动补 boundary） */
export const MULTIPART_HEADERS = {
  'Content-Type': 'multipart/form-data',
};
