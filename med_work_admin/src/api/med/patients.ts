/**
 * 患者档案接口封装（/api/patients）。
 */
import type {
  AnalysisEvolutionResponse,
  MedicalRecordItem,
  MedicalRecordListResponse,
  MedicalRecordParseResult,
  MedicalRecordPayload,
  PatientDetailItem,
  PatientItem,
  PatientListQuery,
  PatientListResponse,
  PatientPayload,
  PatientReportRange,
  PatientTimelineResponse,
  ReportFormat,
} from '#/types/med';

import { downloadFile } from '#/api/med/download';
import { patchRequest } from '#/api/med/_utils';
import { requestClient } from '#/api/request';

/** 患者列表（分页 + 关键词 / 科室 / 状态筛选） */
export function getPatients(query: PatientListQuery = {}) {
  return requestClient.get<PatientListResponse>('/patients', {
    params: query,
  });
}

/** 患者详情（含绑定企微群） */
export function getPatientDetail(id: number) {
  return requestClient.get<PatientDetailItem>(`/patients/${id}`);
}

/** 新增患者 */
export function createPatient(payload: PatientPayload) {
  return requestClient.post<PatientItem>('/patients', payload);
}

/** 更新患者 */
export function updatePatient(id: number, payload: Partial<PatientPayload>) {
  return patchRequest<PatientItem>(`/patients/${id}`, payload);
}

/** 删除患者（软删除） */
export function deletePatient(id: number) {
  return requestClient.delete<{ ok: boolean }>(`/patients/${id}`);
}

// ==================== 病历记录 ====================

/** 病历记录列表（按创建时间倒序） */
export function getMedicalRecords(patientId: number) {
  return requestClient.get<MedicalRecordListResponse>(
    `/patients/${patientId}/medical-records`,
  );
}

/** 新建病历记录 */
export function createMedicalRecord(
  patientId: number,
  payload: MedicalRecordPayload,
) {
  return requestClient.post<MedicalRecordItem>(
    `/patients/${patientId}/medical-records`,
    payload,
  );
}

/** 更新病历记录 */
export function updateMedicalRecord(
  patientId: number,
  recordId: number,
  payload: MedicalRecordPayload,
) {
  return patchRequest<MedicalRecordItem>(
    `/patients/${patientId}/medical-records/${recordId}`,
    payload,
  );
}

/** 删除病历记录（软删除） */
export function deleteMedicalRecord(patientId: number, recordId: number) {
  return requestClient.delete<{ ok: boolean }>(
    `/patients/${patientId}/medical-records/${recordId}`,
  );
}

/** 患者时间线（病历 + AI 分析合并事件流，按时间倒序） */
export function getPatientTimeline(
  patientId: number,
  range: PatientReportRange = {},
) {
  return requestClient.get<PatientTimelineResponse>(
    `/patients/${patientId}/timeline`,
    { params: range },
  );
}

/**
 * 导出患者诊疗分析报告（Word / PDF）。
 * 后端返回 .docx / .pdf 附件，文件名由 Content-Disposition 指定。
 */
export function downloadPatientReport(
  patientId: number,
  range: PatientReportRange = {},
  format: ReportFormat = 'docx',
): Promise<void> {
  const search = new URLSearchParams();
  if (range.start_date) search.set('start_date', range.start_date);
  if (range.end_date) search.set('end_date', range.end_date);
  if (format === 'pdf') search.set('format', 'pdf');
  const query = search.toString();
  return downloadFile(
    `/api/patients/${patientId}/report${query ? `?${query}` : ''}`,
    format === 'pdf' ? '患者诊疗分析报告.pdf' : '患者诊疗分析报告.docx',
  );
}

/** 患者分析演变（关注点轨迹 + 诊断结论时间线） */
export function getPatientAnalysisEvolution(patientId: number) {
  return requestClient.get<AnalysisEvolutionResponse>(
    `/patients/${patientId}/analysis-evolution`,
  );
}

/** AI 解析病历文件（图片/PDF/Word），返回结构化字段 */
export function parseMedicalRecordFile(patientId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  return requestClient.post<MedicalRecordParseResult>(
    `/patients/${patientId}/medical-records/parse`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
}
