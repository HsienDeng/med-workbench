/**
 * AI 分析结论归档接口封装（归档到病历）。
 *
 * 后端：POST /api/patients/{patientId}/medical-records/{recordId}/archive-analysis
 * 将某条「已完成且属于该患者」的分析 result 快照写入病历 ai_conclusion 字段，
 * 返回更新后的病历详情（含 ai_conclusion / ai_conclusion_at / ai_conclusion_source_id）。
 */
import { request } from './api';
import type { ArchiveAnalysisPayload, MedicalRecordItem } from '@/types';

/** 归档指定分析结论到病历，返回更新后的病历详情 */
export function archiveAnalysisToRecord(
  patientId: number,
  recordId: number,
  payload: ArchiveAnalysisPayload,
): Promise<MedicalRecordItem> {
  return request<MedicalRecordItem>(
    `/api/patients/${patientId}/medical-records/${recordId}/archive-analysis`,
    {
      method: 'POST',
      body: payload,
    },
  );
}
