/** 业务字典编码：与后端 DICTIONARY_SEED 的 dict_code 保持一致 */
export const DICT_DOC_TYPE = 'doc_type';
export const DICT_INDEX_STATUS = 'index_status';
export const DICT_SOURCE_TYPE = 'source_type';
export const DICT_DEPT = 'department';
export const DICT_PATIENT_STATUS = 'patient_status';

export interface DictOptionItem {
  label: string;
  value: string;
}

/** 文档类型兜底选项（字典不可用/未加载时使用，与字典种子一致） */
export const FALLBACK_DOC_TYPE_OPTIONS: DictOptionItem[] = [
  { label: '临床指南', value: 'guide' },
  { label: '医学文献', value: 'literature' },
  { label: '药品说明书', value: 'drug' },
  { label: '院内规范', value: 'norm' },
  { label: '疑难病例', value: 'case' },
  { label: '其他', value: 'other' },
];

/** 索引状态兜底选项 */
export const FALLBACK_INDEX_STATUS_OPTIONS: DictOptionItem[] = [
  { label: '未索引', value: 'uploaded' },
  { label: '处理中', value: 'parsing' },
  { label: '已索引', value: 'ready' },
  { label: '索引失败', value: 'failed' },
];

/** 来源分类兜底选项 */
export const FALLBACK_SOURCE_TYPE_OPTIONS: DictOptionItem[] = [
  { label: '本地上传', value: 'system' },
  { label: 'IMA 搬运', value: 'ima' },
];

/** 科室兜底选项（与字典种子一致） */
export const FALLBACK_DEPT_OPTIONS: DictOptionItem[] = [
  { label: '内科', value: 'internal' },
  { label: '外科', value: 'surgery' },
  { label: '儿科', value: 'pediatrics' },
  { label: '妇产科', value: 'obstetrics' },
  { label: '急诊科', value: 'emergency' },
  { label: '心血管内科', value: 'cardiology' },
  { label: '神经内科', value: 'neurology' },
  { label: '骨科', value: 'orthopedics' },
];

/** 患者状态兜底选项（与字典种子一致） */
export const FALLBACK_PATIENT_STATUS_OPTIONS: DictOptionItem[] = [
  { label: '在院', value: 'in' },
  { label: '出院', value: 'out' },
  { label: '转院', value: 'transfer' },
];
