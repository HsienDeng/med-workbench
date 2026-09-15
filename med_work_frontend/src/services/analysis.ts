/**
 * AI 病历分析接口封装（/api/analysis）。
 *
 * 前端不直接调用第三方大模型，由后端取病历文本 + 检索本机构知识库后
 * 调用 AI 分析并将结果持久化，前端负责发起、展示与历史回看。
 */
import { request } from './api';
import type {
  AnalysisCreatePayload,
  AnalysisRecordItem,
  AnalysisRecordListQuery,
  AnalysisRecordListResponse,
  AnalysisStats,
  AnalysisTrendResponse,
} from '@/types';

/** 创建病历分析（选择患者 + 病历 + 分析类型，结果持久化） */
export function createAnalysis(payload: AnalysisCreatePayload): Promise<AnalysisRecordItem> {
  return request<AnalysisRecordItem>('/api/analysis/record', {
    method: 'POST',
    body: payload,
  });
}

/** 历史分析记录列表（分页，当前用户，可按状态/类型/患者关键词过滤） */
export function listAnalysisRecords(
  page = 1,
  pageSize = 20,
  query: AnalysisRecordListQuery = {},
): Promise<AnalysisRecordListResponse> {
  const search = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  return request<AnalysisRecordListResponse>(`/api/analysis/records?${search.toString()}`);
}

/** 分析任务统计（总数 / 成功 / 失败 / 今日新增） */
export function getAnalysisStats(): Promise<AnalysisStats> {
  return request<AnalysisStats>('/api/analysis/records/stats');
}

/** 分析任务趋势（近 N 天按日统计，工作台图表用） */
export function getAnalysisTrend(days = 14): Promise<AnalysisTrendResponse> {
  return request<AnalysisTrendResponse>(`/api/analysis/records/trend?days=${days}`);
}

/** 分析记录详情 */
export function getAnalysisRecord(id: number): Promise<AnalysisRecordItem> {
  return request<AnalysisRecordItem>(`/api/analysis/records/${id}`);
}

/** 删除分析记录 */
export function deleteAnalysisRecord(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/analysis/records/${id}`, { method: 'DELETE' });
}

/** 重试失败的分析记录（同参数重跑并回写原记录） */
export function retryAnalysisRecord(id: number): Promise<AnalysisRecordItem> {
  return request<AnalysisRecordItem>(`/api/analysis/records/${id}/retry`, { method: 'POST' });
}
