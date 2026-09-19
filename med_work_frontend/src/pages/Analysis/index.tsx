import { useCallback, useEffect, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
} from 'antd';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { PageHead } from '@/components';
import PermGate from '@/components/PermGate';
import { colors } from '@/theme';
import { ANALYSIS_TYPES } from '@/types';
import type { AnalysisRecordItem, AnalysisStats, MedicalRecordItem, PatientItem } from '@/types';
import { getMedicalRecords, getPatientDetail, getPatients } from '@/services/patients';
import {
  createAnalysis,
  deleteAnalysisRecord,
  getAnalysisStats,
  listAnalysisRecords,
  retryAnalysisRecord,
} from '@/services/analysis';
import PatientCard from './components/PatientCard';
import ConclusionCard from './components/ConclusionCard';
import AttentionCard from './components/AttentionCard';
import EvidenceCard from './components/EvidenceCard';

const PAGE_SIZE = 10;

/** 分析类型 → 标签颜色 */
const TYPE_COLOR: Record<string, string> = {
  record: 'blue',
  medication: 'purple',
  risk: 'volcano',
  exam: 'cyan',
};

/** 任务状态 → 标签 */
const STATUS_TAG: Record<string, { color: string; text: string }> = {
  done: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
};

type StatusTab = 'all' | 'done' | 'failed';

function formatTime(iso?: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '-';
}

function typeLabel(type: string): string {
  return ANALYSIS_TYPES.find((t) => t.value === type)?.label ?? type;
}

export default function Analysis() {
  const { message } = AntApp.useApp();

  // 发起分析：患者/病历选择
  const [patients, setPatients] = useState<PatientItem[]>([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patient, setPatient] = useState<PatientItem | null>(null);
  const [records, setRecords] = useState<MedicalRecordItem[]>([]);
  const [recordId, setRecordId] = useState<number | null>(null);

  // 发起分析
  const [analysisType, setAnalysisType] = useState('record');
  const [analyzing, setAnalyzing] = useState(false);
  const [current, setCurrent] = useState<AnalysisRecordItem | null>(null);

  // 任务统计
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // 任务列表与筛选
  const [items, setItems] = useState<AnalysisRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<StatusTab>('all');
  const [filterType, setFilterType] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');

  const resultRef = useRef<HTMLDivElement>(null);

  const searchPatients = useCallback(async (kw: string) => {
    setPatientLoading(true);
    try {
      const res = await getPatients({ keyword: kw, page: 1, page_size: 50 });
      setPatients(res.items);
    } catch {
      // 全局错误已由 api.ts 提示
    } finally {
      setPatientLoading(false);
    }
  }, []);

  const loadRecords = useCallback(async (patientId: number) => {
    setRecords([]);
    setRecordId(null);
    try {
      const res = await getMedicalRecords(patientId);
      setRecords(res.items);
    } catch {
      // 全局错误已由 api.ts 提示
    }
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await getAnalysisStats());
    } catch {
      // 全局错误已由 api.ts 提示
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAnalysisRecords(page, PAGE_SIZE, {
        status: tab === 'all' ? undefined : tab,
        analysis_type: filterType || undefined,
        keyword: keyword.trim() || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      // 全局错误已由 api.ts 提示
    } finally {
      setLoading(false);
    }
  }, [page, tab, filterType, keyword]);

  useEffect(() => {
    void searchPatients('');
  }, [searchPatients]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const applyKeyword = () => {
    setKeyword(keywordInput.trim());
    setPage(1);
  };

  /** 发起 / 重新分析：成功后结果展示到结果区并滚动定位 */
  const runAnalysis = async (payload?: { patient_id: number; medical_record_id: number; analysis_type: string }) => {
    const body =
      payload ??
      (patient && recordId
        ? { patient_id: patient.id, medical_record_id: recordId, analysis_type: analysisType }
        : null);
    if (!body) return;
    setAnalyzing(true);
    try {
      const item = await createAnalysis(body);
      setCurrent(item);
      message.success('分析完成');
      await Promise.all([loadList(), loadStats()]);
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      // 失败记录已由后端落库，全局错误已提示
      await Promise.all([loadList(), loadStats()]);
    } finally {
      setAnalyzing(false);
    }
  };

  /** 查看历史任务：回填患者/病历选择，结果展示到结果区 */
  const viewHistory = async (item: AnalysisRecordItem) => {
    setCurrent(item);
    try {
      const detail = await getPatientDetail(item.patient_id);
      setPatient(detail);
      setRecordId(item.medical_record_id);
      const res = await getMedicalRecords(item.patient_id);
      setRecords(res.items);
    } catch {
      // 患者信息尽力回填，失败不影响结果展示
    }
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** 重试失败任务：同参数重跑并回写原记录，成功后把结果展示到结果区 */
  const handleRetry = async (item: AnalysisRecordItem) => {
    setAnalyzing(true);
    try {
      const updated = await retryAnalysisRecord(item.id);
      setCurrent(updated);
      message.success(`任务 #${item.id} 重试成功`);
      await Promise.all([loadList(), loadStats()]);
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      // 失败已由后端回写 error，全局错误已提示
      await Promise.all([loadList(), loadStats()]);
    } finally {
      setAnalyzing(false);
    }
  };

  /** 删除任务：物理删除后刷新列表与统计；若删除的是当前结果则清空 */
  const removeRecord = async (item: AnalysisRecordItem) => {
    try {
      await deleteAnalysisRecord(item.id);
      message.success(`任务 #${item.id} 已删除`);
      if (current?.id === item.id) {
        setCurrent(null);
        setPatient(null);
        setRecordId(null);
        setRecords([]);
      }
      await Promise.all([loadList(), loadStats()]);
    } catch {
      // 错误已由 api.ts 全局提示
    }
  };

  const selectedRecord = records.find((r) => r.id === recordId) ?? null;

  const typeTag = (type: string) => (
    <Tag color={TYPE_COLOR[type] ?? 'default'} style={{ marginInlineEnd: 0 }}>
      {typeLabel(type)}
    </Tag>
  );

  const statusTag = (status: string) => {
    const s = STATUS_TAG[status] ?? { color: 'default', text: status };
    return (
      <Tag color={s.color} style={{ marginInlineEnd: 0 }}>
        {s.text}
      </Tag>
    );
  };

  const columns: ColumnsType<AnalysisRecordItem> = [
    {
      title: '任务ID',
      dataIndex: 'id',
      width: 110,
      render: (v: number) => (
        <span className="mono" style={{ color: colors.primary, fontWeight: 600 }}>
          #{v}
        </span>
      ),
    },
    {
      title: '患者',
      dataIndex: 'patient_name',
      ellipsis: true,
      render: (v: string) => <span style={{ fontWeight: 600 }}>{v || '-'}</span>,
    },
    { title: '分析类型', dataIndex: 'analysis_type', width: 130, render: (v: string) => typeTag(v) },
    {
      title: 'AI 模型',
      dataIndex: 'model',
      width: 150,
      ellipsis: true,
      render: (v: string) => (
        <Tag color="purple" style={{ marginInlineEnd: 0 }}>
          {v || '-'}
        </Tag>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => statusTag(v) },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => (
        <span className="mono" style={{ color: colors.textSecondary }}>
          {formatTime(v)}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, item) => (
        <Space size={0}>
          <Button type="link" size="small" style={{ padding: '0 4px' }} onClick={() => void viewHistory(item)}>
            查看
          </Button>
          {item.status === 'failed' ? (
            <PermGate code="analysis:retry">
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px', color: colors.warning }}
                disabled={analyzing}
                onClick={() => void handleRetry(item)}
              >
                重试
              </Button>
            </PermGate>
          ) : (
            <PermGate code="analysis:create">
              <Button
                type="link"
                size="small"
                style={{ padding: '0 4px' }}
                disabled={analyzing}
                onClick={() =>
                  void runAnalysis({
                    patient_id: item.patient_id,
                    medical_record_id: item.medical_record_id,
                    analysis_type: item.analysis_type,
                  })
                }
              >
                重新分析
              </Button>
            </PermGate>
          )}
          <PermGate code="analysis:delete">
            <Popconfirm
              title="确认删除该分析任务？"
              description="删除后不可恢复"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void removeRecord(item)}
            >
              <Button type="link" size="small" danger style={{ padding: '0 4px' }}>
                删除
              </Button>
            </Popconfirm>
          </PermGate>
        </Space>
      ),
    },
  ];

  const statItems = [
    {
      key: 'total',
      label: '全部任务',
      value: stats?.total ?? 0,
      icon: <RobotOutlined />,
      color: colors.primary,
      bg: colors.primaryLight,
    },
    {
      key: 'done',
      label: '已完成',
      value: stats?.done ?? 0,
      icon: <CheckCircleOutlined />,
      color: colors.success,
      bg: colors.successLight,
    },
    {
      key: 'failed',
      label: '失败',
      value: stats?.failed ?? 0,
      icon: <CloseCircleOutlined />,
      color: colors.error,
      bg: colors.errorLight,
    },
    {
      key: 'today',
      label: '今日新增',
      value: stats?.today ?? 0,
      icon: <CalendarOutlined />,
      color: colors.warning,
      bg: colors.warningLight,
    },
  ];

  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title="AI 病历分析"
        subtitle="选择患者与病历，基于本机构知识库生成循证分析；结果自动保存，支持检索、回看与删除。"
      />

      {/* 发起分析面板 */}
      <Card className="panel">
        <Flex gap={16} align="flex-start">
          <div
            className="tile-icon-sm"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.ai})`,
              color: '#fff',
              fontSize: 18,
              marginTop: 2,
            }}
          >
            <ThunderboltOutlined />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>发起新分析</div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 2, marginBottom: 14 }}>
              选择患者与病历，基于本机构知识库生成循证分析，结果自动保存
            </div>
            <div className="launch-form">
              <div className="launch-field">
                <label>
                  <span className="launch-required">*</span>患者
                </label>
                <Select
                  style={{ width: '100%' }}
                  placeholder="搜索并选择患者"
                  showSearch={{
                    filterOption: false,
                    onSearch: (v) => {
                      void searchPatients(v);
                    },
                  }}
                  allowClear
                  labelInValue
                  loading={patientLoading}
                  notFoundContent={patientLoading ? '搜索中…' : '未找到患者'}
                  value={
                    patient ? { value: patient.id, label: `${patient.name}（${patient.patient_no}）` } : undefined
                  }
                  onChange={(val) => {
                    const id = val?.value ?? null;
                    const p = id !== null ? patients.find((x) => x.id === id) ?? null : null;
                    setPatient(p);
                    setRecordId(null);
                    setCurrent(null);
                    if (p) void loadRecords(p.id);
                  }}
                  options={patients.map((p) => ({ value: p.id, label: `${p.name}（${p.patient_no}）` }))}
                />
              </div>
              <div className="launch-field">
                <label>
                  <span className="launch-required">*</span>病历记录
                </label>
                <Select
                  style={{ width: '100%' }}
                  placeholder={patient ? '选择病历记录' : '请先选择患者'}
                  allowClear
                  disabled={!patient}
                  value={recordId}
                  onChange={(id) => {
                    setRecordId(id);
                    setCurrent(null);
                  }}
                  options={records.map((r) => ({
                    value: r.id,
                    label: `病历 #${r.id} · ${(r.created_at ?? '').slice(0, 10) || '-'} ${(r.chief_complaint ?? '').slice(0, 12) || '无主诉'}`,
                  }))}
                />
              </div>
              <div className="launch-field">
                <label>分析类型</label>
                <Select
                  style={{ width: '100%' }}
                  value={analysisType}
                  onChange={setAnalysisType}
                  options={ANALYSIS_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                />
              </div>
              <div className="launch-cta">
                <PermGate code="analysis:create">
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={analyzing}
                    disabled={!patient || !recordId || analyzing}
                    onClick={() => void runAnalysis()}
                  >
                    开始分析
                  </Button>
                </PermGate>
              </div>
            </div>
          </div>
        </Flex>
      </Card>

      {/* 任务统计带 */}
      <Card className="panel" styles={{ body: { padding: '4px 0' } }}>
        <div className="stat-strip">
          {statItems.map((s) => (
            <div className="stat-item" key={s.key}>
              <span className="tile-icon-sm" style={{ background: s.bg, color: s.color }}>
                {s.icon}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="stat-value" style={{ color: s.color }}>
                  {statsLoading ? <Skeleton.Input size="small" active style={{ width: 44 }} /> : s.value}
                </div>
                <div className="stat-label">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 历史任务 */}
      <Card
        className="panel"
        title="历史任务"
        extra={
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              void loadList();
              void loadStats();
            }}
          >
            刷新
          </Button>
        }
      >
        <Flex wrap gap={12} align="center" justify="space-between" style={{ marginBottom: 16 }}>
          <Flex wrap gap={12} align="center">
            <Input
              prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
              placeholder="搜索患者姓名 / 编号"
              allowClear
              style={{ width: 240 }}
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={applyKeyword}
            />
            <Button icon={<SearchOutlined />} onClick={applyKeyword}>
              搜索
            </Button>
            <Select
              style={{ width: 160 }}
              placeholder="全部分析类型"
              allowClear
              value={filterType || undefined}
              onChange={(v) => {
                setFilterType(v ?? '');
                setPage(1);
              }}
              options={ANALYSIS_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Flex>
          <Segmented
            value={tab}
            onChange={(v) => {
              setTab(v as StatusTab);
              setPage(1);
            }}
            options={[
              { label: `全部任务 ${stats?.total ?? 0}`, value: 'all' },
              { label: `已完成 ${stats?.done ?? 0}`, value: 'done' },
              { label: `失败 ${stats?.failed ?? 0}`, value: 'failed' },
            ]}
          />
        </Flex>

        <Table<AnalysisRecordItem>
          rowKey="id"
          size="medium"
          loading={loading}
          columns={columns}
          dataSource={items}
          scroll={{ x: 860 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  total === 0 && !keyword && !filterType && tab === 'all'
                    ? '暂无分析任务，请在上方选择患者与病历发起分析'
                    : '未找到符合条件的任务'
                }
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (t) => (
              <span className="text-muted" style={{ fontSize: 12 }}>
                共 {t} 条任务
              </span>
            ),
            onChange: (p) => setPage(p),
          }}
        />
      </Card>

      {/* 结果区 */}
      <div ref={resultRef} style={{ scrollMarginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {current ? (
          <>
            <div className="grid-2">
              <PatientCard patient={patient} record={selectedRecord} />
              <ConclusionCard
                summary={current.result?.summary ?? {}}
                model={current.model}
                analysisType={current.analysis_type}
                time={formatTime(current.created_at)}
              />
            </div>
            <div className="grid-2">
              <AttentionCard attention={current.result?.attention ?? []} />
              <EvidenceCard evidence={current.result?.evidence ?? []} />
            </div>
          </>
        ) : analyzing ? (
          <Card className="panel">
            <Skeleton active title={{ width: 180 }} paragraph={{ rows: 4 }} />
          </Card>
        ) : (
          <Card className="panel">
            <div className="result-empty-inner">
              <div className="result-empty-icon">
                <FileSearchOutlined />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 16 }}>开始一次 AI 病历分析</div>
              <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                结果自动保存，可随时回看、重新分析或删除
              </div>
              <div className="result-steps">
                <span>1 选择患者</span>
                <span>2 选择病历记录</span>
                <span>3 点击开始分析</span>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
