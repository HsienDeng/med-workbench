/**
 * Mock 数据层
 * 一期使用本地模拟数据，二期接入真实 API 后由 services/*.ts 替换
 */
import type {
  KpiItem,
  PatientInfo,
  LabMetric,
  AiConclusion,
  DiagnosisItem,
  DrugRiskItem,
  CurrentMedItem,
  RagSourceItem,
  PatientRowItem,
  DocCompositionItem,
  RecentDocItem,
  EntityDistributionItem,
  KbQualityItem,
  DocRowItem,
  DocTypeItem,
} from '@/types';

// ==================== AI 病历分析页 ====================
export const patientInfo: PatientInfo = {
  name: '张伟',
  gender: '男',
  age: 58,
  id: 'P-8842',
  chiefComplaint: '反复胸闷、气短 2 周，加重 1 天',
  admission: '2025-08-24 19:42',
  dept: '心内科 · CCU',
  doctor: '邓贤',
  allergy: '青霉素过敏',
  history: ['高血压 10 年', '2 型糖尿病 5 年'],
};

export const labMetrics: LabMetric[] = [
  { label: 'BNP（脑钠肽）', value: '1,842', unit: 'pg/mL', trend: 'up', level: 'critical', ref: '参考 < 125' },
  { label: '肌钙蛋白 I', value: '0.08', unit: 'ng/mL', trend: 'up', level: 'warn', ref: '参考 < 0.04' },
  { label: 'LDL-C', value: '3.8', unit: 'mmol/L', trend: 'up', level: 'warn', ref: '参考 < 2.6' },
  { label: 'HbA1c', value: '7.8', unit: '%', trend: 'up', level: 'warn', ref: '参考 < 7.0' },
  { label: '血肌酐', value: '86', unit: 'μmol/L', trend: '', level: 'ok', ref: '参考 57-97' },
  { label: '血钾', value: '4.2', unit: 'mmol/L', trend: '', level: 'ok', ref: '参考 3.5-5.5' },
];

export const aiConclusion: AiConclusion = {
  model: 'MedGPT-Large',
  version: 'v2.1.0',
  confidence: 96,
  time: '14:32:06',
  summary:
    '患者 58 岁男性，既往高血压、2 型糖尿病史，本次以"反复胸闷、气短 2 周"入院。BNP 显著升高（1,842 pg/mL），结合双肺底湿啰音、双下肢水肿等体征，符合急性心力衰竭（NYHA III 级）表现。心电图提示左室高电压、ST-T 改变，支持左室肥厚背景。',
  suggestion:
    '建议：① 完善超声心动图评估心功能及结构改变；② 严格控制血压，优化利尿剂与 RAAS 抑制剂方案；③ 密切监测肾功能与电解质，警惕高钾血症风险；④ 请内分泌科会诊评估糖尿病方案。',
};

export const diagnoses: DiagnosisItem[] = [
  { code: 'I50.9', name: '心力衰竭（急性失代偿）', conf: 94 },
  { code: 'I11.0', name: '高血压性心脏病', conf: 89 },
  { code: 'E11.9', name: '2 型糖尿病（伴并发症）', conf: 82 },
];

export const drugRisks: DrugRiskItem[] = [
  { drugs: '螺内酯 + ACEI/ARB', level: '严重', desc: '高钾血症风险显著升高，需密切监测血钾', levelType: 'error' },
  { drugs: '二甲双胍', level: '中等', desc: '造影前后需停用，注意肾功能监测（eGFR < 30 禁用）', levelType: 'warning' },
  { drugs: '阿托伐他汀', level: '低', desc: '常规监测肝酶，与 CYP3A4 抑制剂联用注意剂量', levelType: 'ok' },
];

export const currentMeds: CurrentMedItem[] = [
  { name: '培哚普利', cls: 'ACEI', note: '4mg qd' },
  { name: '螺内酯', cls: 'MRA', note: '20mg qd · 高钾风险', warn: true },
  { name: '阿托伐他汀', cls: '他汀类', note: '20mg qn' },
  { name: '二甲双胍', cls: '双胍类', note: '500mg bid · 肾功能监测', warn: true },
  { name: '呋塞米', cls: '袢利尿剂', note: '20mg iv qd' },
];

export const ragSources: RagSourceItem[] = [
  { type: '指南', title: '中国心力衰竭诊断和治疗指南（2024）', meta: '卫健委 · 2024-05', score: 0.96 },
  { type: '文献', title: 'BNP 在急性心衰诊断中的预测价值（JACC 2023）', meta: 'JACC · 2023-11', score: 0.93 },
  { type: '药品', title: '螺内酯注射液说明书（重点提示高钾血症）', meta: '药品说明书库 · v3.2', score: 0.91 },
  { type: '文献', title: 'HFpEF 与 HFrEF 的鉴别诊断路径', meta: 'NEJM Review · 2024-02', score: 0.89 },
  { type: '指南', title: '慢性心力衰竭加重患者综合管理专家共识（2023）', meta: '中华医学会 · 2023-08', score: 0.88 },
  { type: '文献', title: '心衰合并肾功能不全的药物治疗策略', meta: 'Kidney Int · 2023-06', score: 0.86 },
  { type: '药品', title: '培哚普利说明书（RAAS 抑制剂用药要点）', meta: '药品说明书库 · v3.1', score: 0.85 },
  { type: '病例', title: '本院 2024 年心衰再入院病例分析（CCU）', meta: '科室病例库 · 2024-12', score: 0.83 },
  { type: '指南', title: '2 型糖尿病合并心力衰竭患者管理建议', meta: 'ADA/ESC · 2024-01', score: 0.82 },
];

// ==================== 患者档案页 ====================
export const patientRows: PatientRowItem[] = [
  { id: 'P-8842', name: '张伟', gender: '男', age: 58, dept: '心内科 · CCU', bed: 'A-08', diag: '急性心力衰竭', admission: '2025-08-24', count: 6, doctor: '邓贤', status: 'in' },
  { id: 'P-8821', name: '刘秀英', gender: '女', age: 67, dept: '心内科', bed: 'B-12', diag: '冠心病 不稳定型心绞痛', admission: '2025-08-22', count: 3, doctor: '陈静', status: 'in' },
  { id: 'P-8809', name: '王建国', gender: '男', age: 62, dept: '内分泌科', bed: 'C-03', diag: '2 型糖尿病 糖尿病肾病', admission: '2025-08-20', count: 4, doctor: '刘洋', status: 'in' },
  { id: 'P-8796', name: '陈淑芬', gender: '女', age: 71, dept: '心内科 · CCU', bed: 'A-05', diag: '高血压性心脏病', admission: '2025-08-18', count: 5, doctor: '邓贤', status: 'in' },
  { id: 'P-8782', name: '赵国强', gender: '男', age: 55, dept: '肾内科', bed: 'D-07', diag: '慢性肾脏病 3 期', admission: '2025-08-16', count: 2, doctor: '周敏', status: 'in' },
  { id: 'P-8770', name: '李秀兰', gender: '女', age: 63, dept: '心内科', bed: 'B-02', diag: '心律失常 房颤', admission: '2025-08-14', count: 7, doctor: '陈静', status: 'in' },
  { id: 'P-8755', name: '孙立军', gender: '男', age: 48, dept: '神经内科', bed: 'E-09', diag: '脑梗死恢复期', admission: '2025-08-11', count: 1, doctor: '吴丹', status: 'out' },
  { id: 'P-8741', name: '周桂英', gender: '女', age: 59, dept: '心内科', bed: 'B-06', diag: '慢性心力衰竭', admission: '2025-08-09', count: 9, doctor: '邓贤', status: 'out' },
];

// ==================== 知识库总览页 ====================
export const kbKpis: KpiItem[] = [
  { label: '文档总数', value: '12,486', unit: '篇', trend: '+86', trendDir: 'up', desc: '本周新增', icon: 'docs' },
  { label: '待审核文档', value: '6', unit: '篇', trend: '', trendDir: '', desc: '需要确认后启用', icon: 'review' },
  { label: '本月更新', value: '286', unit: '篇', trend: '', trendDir: '', desc: '新增与修订内容', icon: 'update' },
  { label: '有效文档', value: '99.4', unit: '%', trend: '', trendDir: '', desc: '已审核且在有效期内', icon: 'valid' },
];

export const docComposition: DocCompositionItem[] = [
  { name: '临床指南', count: '4,876', ratio: 78 },
  { name: '医学文献', count: '3,624', ratio: 58 },
  { name: '药品说明书', count: '2,012', ratio: 32 },
  { name: '疑难病例', count: '1,758', ratio: 28 },
  { name: '院内规范', count: '216', ratio: 6 },
];

export const recentDocs: RecentDocItem[] = [
  { title: '2025 年 ESC 心衰指南更新解读', type: '指南', source: 'ESC 官方', uploader: '邓贤', time: '2025-08-26 10:24', status: 'done' },
  { title: '替格瑞洛临床应用专家共识', type: '指南', source: '中华心血管病杂志', uploader: '陈静', time: '2025-08-25 16:08', status: 'done' },
  { title: '慢性肾脏病合并心衰用药综述', type: '文献', source: 'KDIGO 2024', uploader: '周敏', time: '2025-08-25 09:45', status: 'done' },
  { title: '沙库巴曲缬沙坦说明书（2025 修订版）', type: '药品', source: '药品说明书库', uploader: '系统', time: '2025-08-24 20:15', status: 'review' },
  { title: '本院 CCU 急性心衰处置流程（v3）', type: '规范', source: '科室内部', uploader: '邓贤', time: '2025-08-24 11:30', status: 'done' },
];

export const entityDistribution: EntityDistributionItem[] = [
  { name: '药品名称', value: 19.4, count: '19.4 万' },
  { name: '诊断 / ICD-10', value: 12.7, count: '12.7 万' },
  { name: '症状 / 主诉', value: 9.8, count: '9.8 万' },
  { name: '检验指标', value: 6.7, count: '6.7 万' },
];

export const kbQuality: KbQualityItem[] = [
  { label: '向量索引覆盖率', value: '99.2%', ratio: 99.2, color: 'ai' },
  { label: '实体链接准确率', value: '96.8%', ratio: 96.8, color: '' },
  { label: '文档审核通过率', value: '91.5%', ratio: 91.5, color: '' },
  { label: '待审核文档', value: '4 篇', ratio: 0, color: 'warning' },
  { label: '失效外链', value: '2 个', ratio: 0, color: 'warning' },
];

// ==================== 文档管理页 ====================
export const docRows: DocRowItem[] = [
  { name: '2025 年 ESC 心衰指南更新解读.pdf', type: '指南', size: '2.4 MB', chunks: 186, status: 'done', time: '2025-08-26 10:24', uploader: '邓贤' },
  { name: '替格瑞洛临床应用专家共识.docx', type: '指南', size: '1.1 MB', chunks: 92, status: 'done', time: '2025-08-25 16:08', uploader: '陈静' },
  { name: '慢性肾脏病合并心衰用药综述.pdf', type: '文献', size: '3.8 MB', chunks: 241, status: 'done', time: '2025-08-25 09:45', uploader: '周敏' },
  { name: '沙库巴曲缬沙坦说明书（2025 修订版）.docx', type: '药品', size: '480 KB', chunks: 38, status: 'review', time: '2025-08-24 20:15', uploader: '系统' },
  { name: '本院 CCU 急性心衰处置流程（v3）.pdf', type: '规范', size: '1.6 MB', chunks: 74, status: 'done', time: '2025-08-24 11:30', uploader: '邓贤' },
  { name: 'PCI 术后双抗治疗管理规范.docx', type: '规范', size: '860 KB', chunks: 65, status: 'failed', time: '2025-08-23 15:42', uploader: '陈静' },
  { name: '肥厚型心肌病诊断与治疗指南.pdf', type: '指南', size: '4.2 MB', chunks: 268, status: 'done', time: '2025-08-22 09:18', uploader: '系统' },
  { name: 'β 受体阻滞剂在心血管疾病中的应用.docx', type: '文献', size: '2.0 MB', chunks: 134, status: 'done', time: '2025-08-21 14:05', uploader: '刘洋' },
];

export const docTypes: DocTypeItem[] = [
  { key: 'all', label: '全部类型', count: 12486 },
  { key: 'guide', label: '临床指南', count: 4876 },
  { key: 'literature', label: '医学文献', count: 3624 },
  { key: 'drug', label: '药品说明书', count: 2012 },
  { key: 'case', label: '疑难病例', count: 1758 },
  { key: 'norm', label: '院内规范', count: 216 },
];
