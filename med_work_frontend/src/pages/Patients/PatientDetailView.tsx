import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  MedicineBoxOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { PageHead } from '@/components';
import PermGate from '@/components/PermGate';
import { colors } from '@/theme';
import { useDictionaryOptions } from '@/hooks';
import {
  DICT_DEPT,
  DICT_PATIENT_STATUS,
  FALLBACK_DEPT_OPTIONS,
  FALLBACK_PATIENT_STATUS_OPTIONS,
} from '@/constants/dictionary';
import {
  createMedicalRecord,
  deleteMedicalRecord,
  getMedicalRecords,
  getPatientDetail,
  getPatientTimeline,
  parseMedicalRecordFile,
  updateMedicalRecord,
  updatePatient,
} from '@/services/patients';
import type {
  MedicalRecordItem,
  MedicalRecordPayload,
  MedicalRecordParseResult,
  PatientDetailItem,
  PatientPayload,
  PatientTimelineEvent,
} from '@/types';
import AnalysisEvolution from './components/AnalysisEvolution';
import PatientTimeline from './components/PatientTimeline';
import RecordAiArchivePanel from './components/RecordAiArchivePanel';
import ReportExportModal from './components/ReportExportModal';

/** 患者状态 → Tag 颜色 */
const STATUS_COLOR: Record<string, string> = {
  in: 'blue',
  out: 'default',
  transfer: 'orange',
};

const GENDER_LABEL: Record<string, string> = {
  male: '男',
  female: '女',
};

/** ISO 时间 → 本地展示串 */
function formatTime(iso: string): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 16);
}

/** BMI = 体重(kg) / 身高(m)^2，保留 1 位小数 */
function calcBMI(height?: number | null, weight?: number | null): number | null {
  if (height && weight && height > 0) {
    return Math.round((weight / ((height / 100) ** 2)) * 10) / 10;
  }
  return null;
}

/** 病历字段元信息（新建 / 编辑表单与详情展示共用） */
const RECORD_FIELDS: {
  key: keyof MedicalRecordPayload;
  label: string;
  placeholder: string;
  rows: number;
  /** 表单占位：1 = 半列，2 = 整行（默认） */
  span?: 1 | 2;
}[] = [
  { key: 'chief_complaint', label: '主诉', placeholder: '如：反复咳嗽伴发热 3 天', rows: 3, span: 2 },
  { key: 'present_illness', label: '现病史', placeholder: '发病经过、症状演变、院外诊疗经过…', rows: 5, span: 2 },
  { key: 'past_history', label: '既往史', placeholder: '既往疾病、手术、外伤、输血史…', rows: 4 },
  { key: 'allergy_history', label: '过敏史', placeholder: '食物、药物及接触物过敏史', rows: 3 },
  { key: 'drug_allergy_history', label: '药敏史', placeholder: '药物过敏种类与表现', rows: 3 },
  { key: 'family_history', label: '家族史', placeholder: '家族遗传性疾病、肿瘤史等', rows: 3 },
  { key: 'physical_exam', label: '体格检查', placeholder: '生命体征、专科查体所见…', rows: 4, span: 2 },
  { key: 'treatment_advice', label: '处理意见', placeholder: '诊断意见与处置方案', rows: 4, span: 2 },
  { key: 'lab_tests', label: '检验', placeholder: '血常规、生化、尿便常规等', rows: 4 },
  { key: 'examinations', label: '检查', placeholder: '影像、超声、心电图等', rows: 4 },
  { key: 'treatment', label: '治疗', placeholder: '治疗方案、手术、医嘱', rows: 4 },
  { key: 'medications', label: '药品', placeholder: '药名、剂量、用法频次', rows: 4 },
  { key: 'supplements', label: '补充内容', placeholder: '其他需要记录的信息', rows: 3 },
  { key: 'health_education', label: '健康教育', placeholder: '生活方式、复诊与随访指导', rows: 3 },
];

const RECORD_GROUPS: {
  title: string;
  icon: ReactNode;
  desc: string;
  keys: (keyof MedicalRecordPayload)[];
}[] = [
  {
    title: '病史信息',
    icon: <MedicineBoxOutlined />,
    desc: '主诉 · 现病史 · 既往史',
    keys: [
      'chief_complaint',
      'present_illness',
      'past_history',
      'allergy_history',
      'drug_allergy_history',
      'family_history',
    ],
  },
  {
    title: '诊疗信息',
    icon: <ExperimentOutlined />,
    desc: '查体 · 检验检查 · 治疗用药',
    keys: ['physical_exam', 'treatment_advice', 'lab_tests', 'examinations', 'treatment', 'medications'],
  },
  {
    title: '其他',
    icon: <AppstoreOutlined />,
    desc: '补充信息 · 健康宣教',
    keys: ['supplements', 'health_education'],
  },
];

/** AI 解析来源 → 展示文案 */
const PARSE_SOURCE_LABEL: Record<MedicalRecordParseResult['source'], string> = {
  image: '图片识别',
  pdf: 'PDF 解析',
  word: 'Word 解析',
  text: '文本解析',
};

interface Props {
  patientId: number;
  onBack: () => void;
}

export default function PatientDetailView({ patientId, onBack }: Props) {
  const { message } = AntApp.useApp();

  // ---------- 字典 ----------
  const { options: deptOptions, labels: deptLabels } = useDictionaryOptions(DICT_DEPT, FALLBACK_DEPT_OPTIONS);
  const { options: statusOptions, labels: statusLabels } = useDictionaryOptions(
    DICT_PATIENT_STATUS,
    FALLBACK_PATIENT_STATUS_OPTIONS,
  );

  // ---------- 患者 ----------
  const [patient, setPatient] = useState<PatientDetailItem | null>(null);
  const [patientLoading, setPatientLoading] = useState(true);

  // ---------- 病历记录 ----------
  const [records, setRecords] = useState<MedicalRecordItem[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState<number | null>(null);

  // ---------- 时间线（病历 + AI 分析） ----------
  const [timeline, setTimeline] = useState<PatientTimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  /** 右栏 Tab：病历详情 / 时间线 */
  const [rightTab, setRightTab] = useState<'record' | 'timeline' | 'evolution'>('record');

  // ---------- 报告导出 ----------
  const [exportOpen, setExportOpen] = useState(false);

  // ---------- 编辑患者 ----------
  const [patientForm] = Form.useForm<Omit<PatientPayload, 'birth_date'> & { birth_date?: Dayjs | null }>();
  const [patientModalOpen, setPatientModalOpen] = useState(false);
  const [patientSubmitting, setPatientSubmitting] = useState(false);

  // ---------- 新建 / 编辑病历 ----------
  const [recordForm] = Form.useForm<MedicalRecordPayload>();
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MedicalRecordItem | null>(null);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [recordParsing, setRecordParsing] = useState(false);
  const [parseFileName, setParseFileName] = useState('');
  const [lastParse, setLastParse] = useState<{
    source: MedicalRecordParseResult['source'];
    count: number;
  } | null>(null);
  const [recordFilled, setRecordFilled] = useState(0);

  /** 根据表单当前值刷新"已填写 x / 14"进度 */
  const syncRecordFilled = useCallback(() => {
    const values = recordForm.getFieldsValue(true) as MedicalRecordPayload;
    const count = Object.values(values).filter((v) => typeof v === 'string' && v.trim().length > 0).length;
    setRecordFilled(count);
  }, [recordForm]);

  const handleParseRecordFile = useCallback(
    async (file: File) => {
      if (!/\.(png|jpe?g|bmp|webp|pdf|docx?)$/i.test(file.name)) {
        message.error('请上传图片（png/jpg/jpeg/bmp/webp）、PDF 或 Word 文档');
        return;
      }
      setRecordParsing(true);
      setParseFileName(file.name);
      try {
        const result = await parseMedicalRecordFile(patientId, file);
        const { source: _source, ...fields } = result;
        recordForm.setFieldsValue(fields);
        const filled = Object.values(fields).filter((v) => typeof v === 'string' && v.trim().length > 0).length;
        setLastParse({ source: _source, count: filled });
        syncRecordFilled();
        message.success(`AI 已完成${PARSE_SOURCE_LABEL[_source]}，已填入 ${filled} 个字段，请核对后保存`);
      } catch (error) {
        if (error instanceof Error) message.error(error.message);
      } finally {
        setRecordParsing(false);
      }
    },
    [patientId, recordForm, message, syncRecordFilled],
  );

  const loadDetail = useCallback(async () => {
    setPatientLoading(true);
    try {
      setPatient(await getPatientDetail(patientId));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载患者信息失败');
    } finally {
      setPatientLoading(false);
    }
  }, [patientId, message]);

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await getMedicalRecords(patientId);
      setRecords(res.items);
      setActiveRecordId((prev) => (prev && res.items.some((r) => r.id === prev) ? prev : (res.items[0]?.id ?? null)));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载病历记录失败');
    } finally {
      setRecordsLoading(false);
    }
  }, [patientId, message]);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await getPatientTimeline(patientId);
      setTimeline(res.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载时间线失败');
    } finally {
      setTimelineLoading(false);
    }
  }, [patientId, message]);

  useEffect(() => {
    loadDetail();
    loadRecords();
    loadTimeline();
  }, [loadDetail, loadRecords, loadTimeline]);

  const activeRecord = useMemo(
    () => records.find((r) => r.id === activeRecordId) ?? null,
    [records, activeRecordId],
  );

  // ---------- 编辑患者 ----------
  const openEditPatient = useCallback(() => {
    if (!patient) return;
    patientForm.setFieldsValue({
      name: patient.name,
      gender: patient.gender || 'male',
      age: patient.age,
      birth_date: patient.birth_date ? dayjs(patient.birth_date) : undefined,
      allergy_history: patient.allergy_history ?? undefined,
      past_history: patient.past_history ?? undefined,
      height: patient.height ?? undefined,
      weight: patient.weight ?? undefined,
      waistline: patient.waistline ?? undefined,
      phone: patient.phone ?? '',
      primary_diag: patient.primary_diag,
      dept: patient.dept,
      status: patient.status,
    });
    setPatientModalOpen(true);
  }, [patient, patientForm]);

  const handlePatientSubmit = useCallback(async () => {
    const raw = await patientForm.validateFields();
    const values: PatientPayload = {
      ...raw,
      birth_date: raw.birth_date ? dayjs(raw.birth_date).format('YYYY-MM-DD') : null,
      allergy_history: (raw.allergy_history || '').trim() || null,
      past_history: (raw.past_history || '').trim() || null,
    };
    setPatientSubmitting(true);
    try {
      await updatePatient(patientId, values);
      message.success('患者信息已更新');
      setPatientModalOpen(false);
      loadDetail();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setPatientSubmitting(false);
    }
  }, [patientForm, patientId, message, loadDetail]);

  // ---------- 病历新建 / 编辑 ----------
  const openCreateRecord = useCallback(() => {
    setEditingRecord(null);
    recordForm.resetFields();
    setLastParse(null);
    setParseFileName('');
    setRecordFilled(0);
    setRecordModalOpen(true);
  }, [recordForm]);

  const openEditRecord = useCallback(
    (record: MedicalRecordItem) => {
      setEditingRecord(record);
      recordForm.setFieldsValue({
        chief_complaint: record.chief_complaint,
        present_illness: record.present_illness,
        past_history: record.past_history,
        allergy_history: record.allergy_history,
        drug_allergy_history: record.drug_allergy_history,
        family_history: record.family_history,
        physical_exam: record.physical_exam,
        treatment_advice: record.treatment_advice,
        lab_tests: record.lab_tests,
        examinations: record.examinations,
        treatment: record.treatment,
        medications: record.medications,
        supplements: record.supplements,
        health_education: record.health_education,
      });
      syncRecordFilled();
      setRecordModalOpen(true);
    },
    [recordForm, syncRecordFilled],
  );

  const handleRecordSubmit = useCallback(async () => {
    let values: MedicalRecordPayload;
    try {
      values = await recordForm.validateFields();
    } catch {
      return; // 校验失败，表单已就地提示
    }
    setRecordSubmitting(true);
    try {
      if (editingRecord) {
        await updateMedicalRecord(patientId, editingRecord.id, values);
        message.success('病历记录已更新');
      } else {
        const created = await createMedicalRecord(patientId, values);
        setActiveRecordId(created.id);
        message.success('病历记录已创建');
      }
      setRecordModalOpen(false);
      loadRecords();
      loadTimeline();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setRecordSubmitting(false);
    }
  }, [recordForm, editingRecord, patientId, message, loadRecords, loadTimeline]);

  const handleDeleteRecord = useCallback(
    async (record: MedicalRecordItem) => {
      try {
        await deleteMedicalRecord(patientId, record.id);
        message.success('病历记录已删除');
        if (activeRecordId === record.id) setActiveRecordId(null);
        loadRecords();
        loadTimeline();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败');
      }
    },
    [patientId, activeRecordId, message, loadRecords, loadTimeline],
  );

  // BMI 自动预览（编辑患者表单）
  const h = Form.useWatch('height', patientForm);
  const w = Form.useWatch('weight', patientForm);
  const bmiPreview = calcBMI(h, w);

  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title={patient ? `${patient.name} · 病历档案` : '患者详情'}
        subtitle={
          patient
            ? `${patient.patient_no} · ${deptLabels[patient.dept] ?? patient.dept} · ${GENDER_LABEL[patient.gender] ?? '未知'} · ${patient.age} 岁`
            : '加载中...'
        }
        actions={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
              返回列表
            </Button>
            <PermGate code="patient:update">
              <Button icon={<EditOutlined />} onClick={openEditPatient}>
                编辑资料
              </Button>
            </PermGate>
            <PermGate code="patient:export">
              <Button icon={<DownloadOutlined />} onClick={() => setExportOpen(true)}>
                导出报告
              </Button>
            </PermGate>
            <PermGate code="medical_record:create">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRecord}>
                新建病历
              </Button>
            </PermGate>
          </>
        }
      />

      {patientLoading && !patient ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        </Card>
      ) : patient ? (
        <Flex gap={16} align="flex-start">
          {/* ---------- 左栏：患者信息 + 病历列表 ---------- */}
          <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 患者信息 */}
            <Card styles={{ body: { padding: 0 } }}>
              <div
                style={{
                  background: `linear-gradient(135deg, ${colors.primary}, ${colors.ai})`,
                  padding: '18px 20px',
                  color: '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: 'rgba(255,255,255,0.2)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                  >
                    {patient.name[0]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>{patient.name}</div>
                    <div className="mono" style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                      {patient.patient_no}
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto' }}>
                    <Tag color={STATUS_COLOR[patient.status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                      {statusLabels[patient.status] ?? patient.status}
                    </Tag>
                  </div>
                </div>
              </div>
              <div style={{ padding: '14px 20px 18px' }}>
                <Descriptions
                  column={2}
                  size="small"
                  colon={false}
                  items={[
                    { key: 'gender', label: '性别', children: GENDER_LABEL[patient.gender] ?? (patient.gender || '未知') },
                    { key: 'age', label: '年龄', children: `${patient.age} 岁` },
                    { key: 'height', label: '身高', children: patient.height ? `${patient.height} cm` : '—' },
                    { key: 'weight', label: '体重', children: patient.weight ? `${patient.weight} kg` : '—' },
                    { key: 'bmi', label: 'BMI', children: patient.bmi ?? '—' },
                    { key: 'waistline', label: '腰围', children: patient.waistline ? `${patient.waistline} cm` : '—' },
                    {
                      key: 'phone',
                      label: '手机号',
                      children: <span className="mono">{patient.phone || '—'}</span>,
                    },
                    { key: 'dept', label: '科室', children: deptLabels[patient.dept] ?? '—' },
                    {
                      key: 'birth',
                      label: '出生日期',
                      children: patient.birth_date ? <span className="mono" style={{ fontSize: 12 }}>{patient.birth_date}</span> : '—',
                    },
                    {
                      key: 'created',
                      label: '建档时间',
                      children: <span className="mono" style={{ fontSize: 12 }}>{formatTime(patient.created_at)}</span>,
                    },
                  ]}
                />
                <Divider style={{ margin: '10px 0' }} />
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  主诊断
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.textSecondary }}>
                  {patient.primary_diag || '—'}
                </div>
                {(patient.allergy_history || patient.past_history) && (
                  <>
                    <Divider style={{ margin: '10px 0' }} />
                    {patient.allergy_history && (
                      <>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>过敏史</div>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.textSecondary }}>
                          {patient.allergy_history}
                        </div>
                      </>
                    )}
                    {patient.past_history && (
                      <>
                        <div className="text-muted" style={{ fontSize: 12, marginBottom: 6, marginTop: 10 }}>既往史</div>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.textSecondary, whiteSpace: 'pre-wrap' }}>
                          {patient.past_history}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </Card>

            {/* 病历记录列表 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <FileTextOutlined style={{ color: colors.primary }} />
                  <span>病历记录</span>
                  <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                    {records.length}
                  </span>
                </Flex>
              }
              extra={
                <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCreateRecord}>
                  新建
                </Button>
              }
              styles={{ body: { padding: 8 } }}
            >
              {recordsLoading ? (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <Spin size="small" />
                </div>
              ) : records.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无病历记录"
                  style={{ margin: '16px 0' }}
                >
                  <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreateRecord}>
                    新建第一份病历
                  </Button>
                </Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {records.map((r) => {
                    const active = r.id === activeRecordId;
                    return (
                      <div
                        key={r.id}
                        onClick={() => setActiveRecordId(r.id)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          cursor: 'pointer',
                          border: `1px solid ${active ? colors.primaryBorder : 'transparent'}`,
                          background: active ? colors.primaryLight : 'transparent',
                          transition: 'background 0.15s',
                        }}
                      >
                        <Flex align="center" justify="space-between" gap={8}>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: active ? 600 : 500,
                              color: active ? colors.primary : colors.text,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              minWidth: 0,
                            }}
                          >
                            {r.chief_complaint || '（无主诉）'}
                          </span>
                          <Space size={2} onClick={(e) => e.stopPropagation()}>
                            <PermGate code="medical_record:update">
                              <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => openEditRecord(r)}
                              />
                            </PermGate>
                            <PermGate code="medical_record:delete">
                              <Popconfirm
                                title="删除病历记录"
                                description="删除后不可恢复，确定继续吗？"
                                okText="删除"
                                okButtonProps={{ danger: true }}
                                onConfirm={() => handleDeleteRecord(r)}
                              >
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </PermGate>
                          </Space>
                        </Flex>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                          <CalendarOutlined style={{ marginInlineEnd: 4 }} />
                          {formatTime(r.created_at)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* ---------- 右栏：病历详情 / 时间线 ---------- */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Tabs
              activeKey={rightTab}
              onChange={(key) => setRightTab(key as 'record' | 'timeline' | 'evolution')}
              items={[
                {
                  key: 'record',
                  label: (
                    <span>
                      <FileTextOutlined style={{ marginInlineEnd: 6 }} />
                      病历详情
                    </span>
                  ),
                  children: !activeRecord ? (
              <Card>
                <Empty description="点击左侧病历记录查看详情" style={{ padding: '72px 0' }}>
                  <PermGate code="medical_record:create">
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRecord}>
                      新建病历记录
                    </Button>
                  </PermGate>
                </Empty>
              </Card>
            ) : (
              <Card
                title={
                  <Flex align="center" gap={8}>
                    <FileTextOutlined style={{ color: colors.primary }} />
                    <span>病历详情</span>
                    <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                      更新于 {formatTime(activeRecord.updated_at)}
                    </span>
                  </Flex>
                }
                extra={
                  <Space size={4}>
                    <PermGate code="medical_record:update">
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEditRecord(activeRecord)}>
                        编辑
                      </Button>
                    </PermGate>
                    <PermGate code="medical_record:delete">
                      <Popconfirm
                        title="删除病历记录"
                        description="删除后不可恢复，确定继续吗？"
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleDeleteRecord(activeRecord)}
                      >
                        <Button size="small" danger icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </PermGate>
                  </Space>
                }
              >
                <PermGate code="medical_record:archive">
                  <RecordAiArchivePanel
                    patientId={patientId}
                    record={activeRecord}
                    events={timeline}
                    onArchived={() => loadRecords()}
                  />
                </PermGate>
                <div style={{ height: 16 }} />
                {RECORD_GROUPS.map((group) => {
                  const items = group.keys.map((key) => {
                    const meta = RECORD_FIELDS.find((f) => f.key === key)!;
                    const value = activeRecord[key] || '';
                    return { key, meta, value };
                  });
                  if (items.every((i) => !i.value)) return null;
                  return (
                    <div key={group.title} style={{ marginBottom: 18 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: colors.primary,
                          letterSpacing: 0.5,
                          marginBottom: 10,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            width: 3,
                            height: 14,
                            borderRadius: 2,
                            background: colors.primary,
                            display: 'inline-block',
                          }}
                        />
                        {group.title}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {items
                          .filter((i) => i.value)
                          .map((i) => (
                            <div key={i.key}>
                              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                {i.meta.label}
                              </div>
                              <div
                                style={{
                                  fontSize: 13.5,
                                  lineHeight: 1.7,
                                  color: colors.text,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {i.value}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
                {RECORD_GROUPS.every((g) => g.keys.every((k) => !activeRecord[k])) && (
                  <Typography.Text type="secondary">这份病历暂无内容，点击右上角「编辑」补充。</Typography.Text>
                )}
              </Card>
                  ),
                },
                {
                  key: 'timeline',
                  label: (
                    <span>
                      <ClockCircleOutlined style={{ marginInlineEnd: 6 }} />
                      时间线{timeline.length ? `（${timeline.length}）` : ''}
                    </span>
                  ),
                  children: (
                    <PatientTimeline
                      events={timeline}
                      loading={timelineLoading}
                      onOpenRecord={(recordId) => {
                        setActiveRecordId(recordId);
                        setRightTab('record');
                      }}
                    />
                  ),
                },
                {
                  key: 'evolution',
                  label: (
                    <span>
                      <BarChartOutlined style={{ marginInlineEnd: 6 }} />
                      分析演变
                    </span>
                  ),
                  children: <AnalysisEvolution patientId={patientId} />,
                },
              ]}
            />
          </div>
        </Flex>
      ) : (
        <Card>
          <Empty description="患者信息加载失败" style={{ padding: 48 }}>
            <Button onClick={onBack}>返回列表</Button>
          </Empty>
        </Card>
      )}

      {/* ---------- 导出患者诊疗分析报告（Word） ---------- */}
      {patient && (
        <ReportExportModal
          open={exportOpen}
          candidates={[{ id: patient.id, name: patient.name, patient_no: patient.patient_no }]}
          defaultIds={[patient.id]}
          lockSelection
          onClose={() => setExportOpen(false)}
        />
      )}

      {/* ---------- 编辑患者 ---------- */}
      <Modal
        title="编辑患者资料"
        open={patientModalOpen}
        onOk={handlePatientSubmit}
        confirmLoading={patientSubmitting}
        onCancel={() => setPatientModalOpen(false)}
        destroyOnClose
        width={560}
      >
        <Form form={patientForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入患者姓名" maxLength={64} />
          </Form.Item>
          <Form.Item name="gender" label="性别" rules={[{ required: true, message: '请选择性别' }]}>
            <Radio.Group>
              <Radio.Button value="male">男</Radio.Button>
              <Radio.Button value="female">女</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="age" label="年龄" rules={[{ required: true, message: '请输入年龄' }]} style={{ flex: 1 }}>
              <InputNumber min={0} max={200} style={{ width: '100%' }} placeholder="岁" />
            </Form.Item>
            <Form.Item name="birth_date" label="出生日期" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
            <Form.Item name="height" label="身高（cm）" style={{ flex: 1 }}>
              <InputNumber min={0} max={250} precision={1} style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
          </Flex>
          <Flex gap={12}>
            <Form.Item name="weight" label="体重（kg）" style={{ flex: 1 }}>
              <InputNumber min={0} max={500} precision={1} style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
            <Form.Item label="BMI（自动计算）" style={{ flex: 1 }}>
              <Input value={bmiPreview ? String(bmiPreview) : ''} placeholder="填身高体重后自动计算" disabled />
            </Form.Item>
            <Form.Item name="waistline" label="腰围（cm）" style={{ flex: 1 }}>
              <InputNumber min={0} max={300} precision={1} style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
          </Flex>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="选填" maxLength={32} />
          </Form.Item>
          <Form.Item name="allergy_history" label="过敏史">
            <Input.TextArea rows={2} placeholder="档案层常驻过敏史，选填" maxLength={2000} />
          </Form.Item>
          <Form.Item name="past_history" label="既往史">
            <Input.TextArea rows={3} placeholder="既往高血压 / 糖尿病 / 手术史等，选填（常驻档案）" maxLength={4000} />
          </Form.Item>
          <Form.Item
            name="primary_diag"
            label="主诊断"
            rules={[{ required: true, message: '请输入主诊断' }]}
          >
            <Input.TextArea rows={2} placeholder="请输入主诊断" maxLength={512} />
          </Form.Item>
          <Form.Item name="dept" label="科室" rules={[{ required: true, message: '请选择科室' }]}>
            <Select placeholder="请选择科室" options={deptOptions} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select placeholder="请选择状态" options={statusOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---------- 新建 / 编辑病历 ---------- */}
      <Modal
        title={editingRecord ? '编辑病历记录' : '新建病历记录'}
        open={recordModalOpen}
        onCancel={() => setRecordModalOpen(false)}
        destroyOnClose
        width={820}
        footer={
          <Flex justify="space-between" align="center">
            <span className="text-muted" style={{ fontSize: 12 }}>
              已填写 {recordFilled} / {RECORD_FIELDS.length} 项
            </span>
            <Space>
              <Button onClick={() => setRecordModalOpen(false)}>取消</Button>
              <Button type="primary" onClick={handleRecordSubmit} loading={recordSubmitting}>
                {editingRecord ? '保存修改' : '创建病历'}
              </Button>
            </Space>
          </Flex>
        }
      >
        {!editingRecord && (
          <PermGate code="medical_record:parse">
            <Upload.Dragger
              accept=".png,.jpg,.jpeg,.bmp,.webp,.pdf,.doc,.docx"
            showUploadList={false}
            disabled={recordParsing}
            beforeUpload={(file) => {
              handleParseRecordFile(file as unknown as File);
              return false;
            }}
            style={{
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 10,
              background: lastParse ? colors.successLight : colors.aiLight,
              border: `1px dashed ${lastParse ? colors.success : colors.aiDark}`,
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            <Flex align="center" gap={12}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: lastParse ? colors.success : colors.aiDark,
                  background: lastParse ? '#D9F1E3' : '#D3F0ED',
                }}
              >
                {recordParsing ? (
                  <Spin size="small" />
                ) : lastParse ? (
                  <CheckOutlined />
                ) : (
                  <RobotOutlined />
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: lastParse ? colors.success : colors.aiDark,
                  }}
                >
                  {recordParsing ? 'AI 正在识别病历资料…' : lastParse ? '已识别并填入表单' : 'AI 智能导入'}
                </div>
                <div
                  className="text-muted"
                  style={{
                    fontSize: 12,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {recordParsing
                    ? parseFileName
                    : lastParse
                      ? `来源：${PARSE_SOURCE_LABEL[lastParse.source]}，已填充 ${lastParse.count} 个字段，可核对修改`
                      : '支持图片识别、PDF、Word 文档，识别后自动填入下方表单'}
                </div>
              </div>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: lastParse ? colors.success : colors.aiDark,
                  whiteSpace: 'nowrap',
                }}
              >
                {recordParsing ? '识别中…' : lastParse ? '重新导入 →' : '上传识别 →'}
              </span>
            </Flex>
            </Upload.Dragger>
          </PermGate>
        )}
        <Form
          form={recordForm}
          layout="vertical"
          onValuesChange={syncRecordFilled}
          style={{ maxHeight: '62vh', overflowY: 'auto', paddingInline: 2, paddingRight: 6 }}
        >
          {RECORD_GROUPS.map((group) => (
            <div
              key={group.title}
              style={{
                background: colors.bgSecondary,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: '14px 16px 2px',
                marginBottom: 14,
              }}
            >
              <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: colors.primaryLight,
                    color: colors.primary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  {group.icon}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{group.title}</span>
                <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {group.desc}
                </span>
              </Flex>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  columnGap: 16,
                }}
              >
                {group.keys.map((key) => {
                  const meta = RECORD_FIELDS.find((f) => f.key === key)!;
                  return (
                    <Form.Item
                      key={key}
                      name={key}
                      label={meta.label}
                      style={{
                        marginBottom: 12,
                        gridColumn: (meta.span ?? 2) === 2 ? '1 / -1' : 'auto',
                      }}
                    >
                      <Input.TextArea rows={meta.rows} placeholder={meta.placeholder} />
                    </Form.Item>
                  );
                })}
              </div>
            </div>
          ))}
        </Form>
      </Modal>
    </div>
  );
}
