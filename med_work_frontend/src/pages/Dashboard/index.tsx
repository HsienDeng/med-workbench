import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Flex, Progress, Skeleton, Table, Tag, Typography } from 'antd';
import {
  ArrowRightOutlined,
  BookOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHead } from '@/components';
import { colors } from '@/theme';
import { ANALYSIS_TYPES } from '@/types';
import type {
  AnalysisRecordItem,
  AnalysisStats,
  AnalysisTrendItem,
  KnowledgeOverview,
  PageKey,
  WxGroupItem,
} from '@/types';
import { getAnalysisStats, getAnalysisTrend, listAnalysisRecords } from '@/services/analysis';
import { getPatients } from '@/services/patients';
import { getKnowledgeOverviewApi } from '@/services/knowledge';
import { listWxGroups } from '@/services/wx';
import TrendChart from './components/TrendChart';
import './index.css';

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  done: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
};

/** 快捷入口（真实模块） */
const QUICK_ACTIONS: Array<{ label: string; desc: string; go: PageKey; icon: React.ReactNode; color: string }> = [
  { label: 'AI 病历分析', desc: '基于本机构知识库生成循证分析', go: 'analysis', icon: <ThunderboltOutlined />, color: colors.primary },
  { label: 'AI 助手', desc: '智能诊疗检索与问答', go: 'assistant', icon: <RobotOutlined />, color: colors.ai },
  { label: '患者档案', desc: '患者信息与病历记录管理', go: 'patients', icon: <TeamOutlined />, color: colors.purple },
  { label: '文档管理', desc: '知识库文档上传与维护', go: 'documents', icon: <FolderOpenOutlined />, color: colors.warning },
  { label: '企业微信随访', desc: '外部群同步与消息推送', go: 'wxGroups', icon: <WechatOutlined />, color: colors.success },
  { label: '字典管理', desc: '医学术语与分类维护', go: 'dictionaries', icon: <BookOutlined />, color: colors.info },
];

function formatTime(iso?: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '-';
}

function typeLabel(type: string): string {
  return ANALYSIS_TYPES.find((t) => t.value === type)?.label ?? type;
}

export default function Dashboard({
  onNavigate,
}: {
  onNavigate: (k: PageKey) => void;
}) {
  // 数据状态
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [trend, setTrend] = useState<AnalysisTrendItem[]>([]);
  const [patientTotal, setPatientTotal] = useState(0);
  const [kb, setKb] = useState<KnowledgeOverview | null>(null);
  const [recent, setRecent] = useState<AnalysisRecordItem[]>([]);
  const [wxTotal, setWxTotal] = useState(0);
  const [wxGroups, setWxGroups] = useState<WxGroupItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, trendRes, patientRes, kbRes, recentRes, wxRes] = await Promise.all([
        getAnalysisStats(),
        getAnalysisTrend(14),
        getPatients({ page: 1, page_size: 1 }),
        getKnowledgeOverviewApi(),
        listAnalysisRecords(1, 5),
        listWxGroups({ page: 1, page_size: 4 }),
      ]);
      setStats(statsRes);
      setTrend(trendRes.items);
      setPatientTotal(patientRes.total);
      setKb(kbRes);
      setRecent(recentRes.items);
      setWxTotal(wxRes.total);
      setWxGroups(wxRes.items);
    } catch {
      // 任一数据源失败：全局错误已由 api.ts 提示，保留已加载部分
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doneRatio = stats && stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  const kpis = [
    {
      key: 'total',
      label: 'AI 分析任务',
      value: String(stats?.total ?? 0),
      unit: '次',
      icon: 'analysis',
      iconColor: 'blue',
      trend: stats ? `+${stats.today}` : undefined,
      trendDir: 'up',
      desc: '今日新增',
    },
    {
      key: 'done',
      label: '已完成分析',
      value: String(stats?.done ?? 0),
      unit: '次',
      icon: 'valid',
      iconColor: 'green',
      desc: stats ? `完成率 ${doneRatio}%` : '',
    },
    {
      key: 'patients',
      label: '在册患者',
      value: String(patientTotal),
      unit: '人',
      icon: 'patients',
      iconColor: 'purple',
      desc: '全部患者档案',
    },
    {
      key: 'docs',
      label: '知识库文档',
      value: String(kb?.total_documents ?? 0),
      unit: '篇',
      icon: 'docs',
      iconColor: 'orange',
      desc: kb ? `已就绪 ${kb.ready_documents} 篇` : '',
    },
  ];

  const docTotal = kb?.total_documents ?? 0;

  const taskColumns: ColumnsType<AnalysisRecordItem> = [
    {
      title: '任务ID',
      dataIndex: 'id',
      width: 90,
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
    {
      title: '分析类型',
      dataIndex: 'analysis_type',
      width: 130,
      render: (v: string) => (
        <Tag color="blue" style={{ marginInlineEnd: 0 }}>
          {typeLabel(v)}
        </Tag>
      ),
    },
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
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => {
        const s = STATUS_TAG[v] ?? { color: 'default', text: v };
        return (
          <Tag color={s.color} style={{ marginInlineEnd: 0 }}>
            {s.text}
          </Tag>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      render: (v: string) => (
        <span className="mono" style={{ color: colors.textSecondary }}>
          {formatTime(v)}
        </span>
      ),
    },
  ];

  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title="工作台总览"
        subtitle="分析任务、患者档案、知识库与企业微信随访运营数据一览"
        actions={
          <>
            <Button icon={<ThunderboltOutlined />} type="primary" onClick={() => onNavigate('analysis')}>
              新建智能分析
            </Button>
            <Button icon={<FolderOpenOutlined />} onClick={() => onNavigate('documents')}>
              文档管理
            </Button>
          </>
        }
      />

      {/* KPI */}
      <div className="kpi-grid">
        {kpis.map(({ key, ...rest }) => (
          <KpiCard key={key} {...rest} />
        ))}
      </div>

      {/* 趋势 + 快捷操作 */}
      <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card
          className="panel"
          title={
            <Flex vertical gap={3}>
              <Typography.Text strong style={{ fontSize: 15 }}>
                AI 分析趋势
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                近 14 天分析任务量
              </Typography.Text>
            </Flex>
          }
          styles={{ body: { padding: '8px 16px 16px' } }}
        >
          {loading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (
            <TrendChart data={trend} />
          )}
        </Card>

        <Card
          className="panel"
          title={
            <Flex vertical gap={3}>
              <Typography.Text strong style={{ fontSize: 15 }}>
                快捷操作
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                常用功能快速入口
              </Typography.Text>
            </Flex>
          }
          styles={{ body: { padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 } }}
        >
          {QUICK_ACTIONS.map((a) => (
            <div
              key={a.label}
              onClick={() => onNavigate(a.go)}
              className="quick-action"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: '#fff',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `${a.color}1A`,
                  color: a.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 16,
                }}
              >
                {a.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{a.label}</div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>{a.desc}</div>
              </div>
              <ArrowRightOutlined style={{ color: colors.textMuted, fontSize: 12 }} />
            </div>
          ))}
        </Card>
      </div>

      {/* 最近任务 + 知识库 / 企微 */}
      <div className="grid-2" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card
          className="panel"
          title={
            <Flex vertical gap={3}>
              <Typography.Text strong style={{ fontSize: 15 }}>
                最近分析任务
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                最新 AI 分析执行记录
              </Typography.Text>
            </Flex>
          }
          extra={
            <Button type="link" style={{ padding: 0 }} onClick={() => onNavigate('analysis')}>
              查看全部 →
            </Button>
          }
          styles={{ body: { padding: 0 } }}
        >
          <Table<AnalysisRecordItem>
            rowKey="id"
            columns={taskColumns}
            dataSource={recent}
            pagination={false}
            size="middle"
            scroll={{ x: 720 }}
            loading={loading}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无分析任务，请前往「AI 病历分析」发起"
                />
              ),
            }}
          />
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            className="panel"
            title={
              <Flex vertical gap={3}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  知识库状态
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  文档覆盖与就绪情况
                </Typography.Text>
              </Flex>
            }
            extra={
              <Button type="link" style={{ padding: 0 }} onClick={() => onNavigate('documents')}>
                管理 →
              </Button>
            }
            styles={{ body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 } }}
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 4 }} />
            ) : (kb?.doc_type_distribution ?? []).length === 0 ? (
              <div className="text-muted" style={{ fontSize: 13, padding: '8px 0' }}>
                暂无文档，请上传知识库文档
              </div>
            ) : (
              <>
                {(kb?.doc_type_distribution ?? []).slice(0, 5).map((d) => (
                  <div key={d.doc_type}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 12,
                        marginBottom: 6,
                      }}
                    >
                      <span className="text-secondary">{d.label || d.doc_type}</span>
                      <strong>{d.count} 篇</strong>
                    </div>
                    <Progress
                      percent={docTotal ? Math.round((d.count / docTotal) * 100) : 0}
                      showInfo={false}
                      strokeColor={colors.primary}
                      trailColor="#EEF1F6"
                      size="small"
                    />
                  </div>
                ))}
                <div
                  style={{
                    padding: 12,
                    background: colors.bgSecondary,
                    borderRadius: 8,
                    fontSize: 12,
                    color: colors.textMuted,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <DatabaseOutlined style={{ color: colors.ai }} />
                  共 {kb?.total_documents ?? 0} 篇 · 向量 {kb?.total_vectors ?? 0} 条 · 就绪{' '}
                  {kb?.ready_documents ?? 0} 篇
                </div>
              </>
            )}
          </Card>

          <Card
            className="panel"
            title={
              <Flex vertical gap={3}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  企业微信随访
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  外部群同步与患者随访
                </Typography.Text>
              </Flex>
            }
            extra={
              <Button type="link" style={{ padding: 0 }} onClick={() => onNavigate('wxGroups')}>
                去管理 →
              </Button>
            }
            styles={{ body: { padding: '8px 20px 16px', display: 'flex', flexDirection: 'column' } }}
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : wxGroups.length === 0 ? (
              <div className="text-muted" style={{ padding: '12px 0', fontSize: 13 }}>
                暂无外部群，可前往企业微信群管理同步或添加
              </div>
            ) : (
              <>
                {wxGroups.slice(0, 4).map((g) => (
                  <div
                    key={g.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 0',
                      borderBottom: `1px dashed ${colors.border}`,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: colors.successLight,
                        color: colors.success,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <WechatOutlined />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>{g.member_count} 名成员</div>
                    </div>
                    {g.patient_name ? (
                      <Tag color="success" style={{ marginInlineEnd: 0 }}>
                        {g.patient_name}
                      </Tag>
                    ) : (
                      <Tag style={{ marginInlineEnd: 0 }}>未绑定</Tag>
                    )}
                  </div>
                ))}
                <div style={{ paddingTop: 10, fontSize: 12, color: colors.textMuted }}>
                  共 {wxTotal} 个外部群
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
