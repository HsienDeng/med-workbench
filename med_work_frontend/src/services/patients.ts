/**
 * 患者档案接口封装（/api/patients）。
 */
import { downloadFile, request } from './api';
import type {
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
  AnalysisEvolutionResponse,
} from '@/types';

function buildQuery(params: PatientListQuery): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** 患者列表（分页 + 关键词 / 科室 / 状态筛选） */
export function getPatients(query: PatientListQuery = {}): Promise<PatientListResponse> {
  return request<PatientListResponse>(`/api/patients${buildQuery(query)}`);
}

/** 患者详情（含绑定企微群） */
export function getPatientDetail(id: number): Promise<PatientDetailItem> {
  return request<PatientDetailItem>(`/api/patients/${id}`);
}

/** 新增患者 */
export function createPatient(payload: PatientPayload): Promise<PatientItem> {
  return request<PatientItem>('/api/patients', { method: 'POST', body: payload });
}

/** 更新患者 */
export function updatePatient(id: number, payload: Partial<PatientPayload>): Promise<PatientItem> {
  return request<PatientItem>(`/api/patients/${id}`, { method: 'PATCH', body: payload });
}

/** 删除患者（软删除） */
export function deletePatient(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/patients/${id}`, { method: 'DELETE' });
}

// ==================== 病历记录 ====================

/** 病历记录列表（按创建时间倒序） */
export function getMedicalRecords(patientId: number): Promise<MedicalRecordListResponse> {
  return request<MedicalRecordListResponse>(`/api/patients/${patientId}/medical-records`);
}

/** 新建病历记录 */
export function createMedicalRecord(
  patientId: number,
  payload: MedicalRecordPayload,
): Promise<MedicalRecordItem> {
  return request<MedicalRecordItem>(`/api/patients/${patientId}/medical-records`, {
    method: 'POST',
    body: payload,
  });
}

/** 更新病历记录 */
export function updateMedicalRecord(
  patientId: number,
  recordId: number,
  payload: MedicalRecordPayload,
): Promise<MedicalRecordItem> {
  return request<MedicalRecordItem>(`/api/patients/${patientId}/medical-records/${recordId}`, {
    method: 'PATCH',
    body: payload,
  });
}

/** 删除病历记录（软删除） */
export function deleteMedicalRecord(
  patientId: number,
  recordId: number,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/patients/${patientId}/medical-records/${recordId}`, {
    method: 'DELETE',
  });
}

/** 患者时间线（病历 + AI 分析合并事件流，按时间倒序） */
export function getPatientTimeline(
  patientId: number,
  range: PatientReportRange = {},
): Promise<PatientTimelineResponse> {
  const search = new URLSearchParams();
  if (range.start_date) search.set('start_date', range.start_date);
  if (range.end_date) search.set('end_date', range.end_date);
  const query = search.toString();
  return request<PatientTimelineResponse>(
    `/api/patients/${patientId}/timeline${query ? `?${query}` : ''}`,
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
export function getPatientAnalysisEvolution(patientId: number): Promise<AnalysisEvolutionResponse> {
  return request<AnalysisEvolutionResponse>(`/api/patients/${patientId}/analysis-evolution`);
}

/** AI 解析病历文件（图片/PDF/Word），返回结构化字段 */
export function parseMedicalRecordFile(
  patientId: number,
  file: File,
): Promise<MedicalRecordParseResult> {
  const form = new FormData();
  form.append('file', file);
  return request<MedicalRecordParseResult>(`/api/patients/${patientId}/medical-records/parse`, {
    method: 'POST',
    body: form,
  });
}
