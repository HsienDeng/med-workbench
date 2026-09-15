import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Divider,
  Empty,
  Flex,
  Modal,
  Radio,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CalendarOutlined,
  FileDoneOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { colors } from '@/theme';
import { ANALYSIS_TYPES, type MedicalRecordItem, type PatientTimelineEvent } from '@/types';
import { archiveAnalysisToRecord } from '@/services/analysisArchive';

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ANALYSIS_TYPES.map((item) => [item.value, item.label]),
);

const LEVEL_COLOR: Record<string, string> = {
  高: 'red',
  中: 'orange',
  低: 'blue',
};

function formatTime(iso?: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

interface RecordAiArchivePanelProps {
  patientId: number;
  record: MedicalRecordItem;
  /** 时间线事件（其中 analysis + done 事件作为归档候选） */
  events: PatientTimelineEvent[];
  /** 归档成功后回调（父级刷新病历列表） */
  onArchived: (updated: MedicalRecordItem) => void;
}

/**
 * 病历详情内的「AI 分析结论归档」面板。
 * - 已归档：展示结论快照（结论摘要 / 关注点 / 循证依据）与来源，可更新归档；
 * - 未归档：提供入口，从该患者已完成的分析中选择一条归档到此病历。
 */
export default function RecordAiArchivePanel({
  patientId,
  record,
  events,
  onArchived,
}: RecordAiArchivePanelProps) {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** 候选：该患者已完成（done）的分析事件 */
  const candidates = useMemo(
    () => events.filter((event) => event.event_type === 'analysis' && event.status === 'done'),
    [events],
  );

  // 每次打开时默认选中：当前来源优先，否则最新一条
  useEffect(() => {
    if (!open) return;
    const preferred =
      record.ai_conclusion_source_id && candidates.some((c) => c.event_id === record.ai_conclusion_source_id)
        ? record.ai_conclusion_source_id
        : candidates[0]?.event_id;
    setSelectedId(preferred ?? null);
  }, [open, record.ai_conclusion_source_id, candidates]);

  const handleArchive = async () => {
    if (!selectedId) {
      message.warning('请选择要归档的分析结论');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await archiveAnalysisToRecord(patientId, record.id, {
        analysis_id: selectedId,
      });
      message.success('AI 分析结论已归档到病历');
      setOpen(false);
      onArchived(updated);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '归档失败');
    } finally {
      setSubmitting(false);
    }
  };

  const conclusion = record.ai_conclusion;
  const summaryEntries = Object.entries(conclusion?.summary ?? {});
  const attention = conclusion?.attention ?? [];
  const evidence = conclusion?.evidence ?? [];

  return (
    <>
      <div
        style={{
          border: `1px solid ${record.ai_conclusion ? '#d9f7be' : colors.primaryBorder}`,
          background: record.ai_conclusion ? '#f6ffed' : colors.primaryLight,
          borderRadius: 10,
          padding: '12px 16px',
        }}
      >
        <Flex align="center" justify="space-between" gap={12} wrap="wrap">
          <Flex align="center" gap={8}>
            {record.ai_conclusion ? (
              <FileDoneOutlined style={{ color: '#389e0d' }} />
            ) : (
              <RobotOutlined style={{ color: colors.primary }} />
            )}
            <Typography.Text strong style={{ fontSize: 13.5 }}>
              {record.ai_conclusion ? 'AI 分析结论（已归档）' : 'AI 分析结论归档'}
            </Typography.Text>
            {record.ai_conclusion_source_id && (
              <Tag color="green" style={{ marginInlineEnd: 0 }}>
                来源分析 #{record.ai_conclusion_source_id}
              </Tag>
            )}
          </Flex>
          <Space size={4}>
            {record.ai_conclusion ? (
              <Button size="small" icon={<RobotOutlined />} onClick={() => setOpen(true)}>
                更新归档
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                ghost
                icon={<RobotOutlined />}
                disabled={candidates.length === 0}
                onClick={() => setOpen(true)}
              >
                归档 AI 结论
              </Button>
            )}
          </Space>
        </Flex>

        {record.ai_conclusion ? (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="text-muted" style={{ fontSize: 12 }}>
              <Space size={14} wrap>
                <span>
                  <CalendarOutlined style={{ marginInlineEnd: 4 }} />
                  归档于 {formatTime(record.ai_conclusion_at)}
                </span>
              </Space>
            </div>
            {summaryEntries.map(([label, value]) => (
              <div key={label}>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 2 }}>
                  {label}
                </div>
                <Typography.Paragraph
                  style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}
                  ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
                >
                  {String(value)}
                </Typography.Paragraph>
              </div>
            ))}
            {attention.length > 0 && (
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>关注点</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {attention.map((item, index) => (
                    <div key={`${item.title}-${index}`} style={{ fontSize: 12.5 }}>
                      <Tag color={LEVEL_COLOR[item.level] ?? 'default'} style={{ marginInlineEnd: 4 }}>
                        {item.level || '提示'}
                      </Tag>
                      <span style={{ fontWeight: 600 }}>{item.title}</span>
                      {item.description && (
                        <div className="text-muted" style={{ marginTop: 2, lineHeight: 1.6 }}>
                          {item.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {evidence.length > 0 && (
              <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                循证依据：{evidence.map((item) => item.source || '未命名来源').join('、')}
              </div>
            )}
            {!summaryEntries.length && attention.length === 0 && evidence.length === 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                该归档结论暂无结构化内容。
              </Typography.Text>
            )}
          </div>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
            可将该患者的某次已完成 AI 分析结论（结论 / 关注点 / 循证依据）快照归档到此病历，便于后续回顾与报告导出。
          </Typography.Text>
        )}
      </div>

      <Modal
        title="归档 AI 分析结论"
        open={open}
        onOk={handleArchive}
        confirmLoading={submitting}
        onCancel={() => setOpen(false)}
        okText="归档"
        cancelText="取消"
        destroyOnClose
        width={560}
      >
        {candidates.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无已完成的分析可归档，请先对该患者发起 AI 分析。"
            style={{ padding: '24px 0' }}
          />
        ) : (
          <div style={{ marginTop: 8 }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              选择该患者的一条已完成分析（将快照写入「{record.chief_complaint?.slice(0, 20) || '本份病历'}」）：
            </div>
            <Radio.Group
              style={{ width: '100%' }}
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map((candidate) => (
                  <Radio
                    key={candidate.event_id}
                    value={candidate.event_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      border: '1px solid #eef1f6',
                      borderRadius: 8,
                      padding: '8px 12px',
                    }}
                  >
                    <span>
                      <Tag color="purple" style={{ marginInlineEnd: 6 }}>
                        {TYPE_LABEL[candidate.analysis_type] ?? candidate.analysis_type}
                      </Tag>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {candidate.summary ? `#${candidate.event_id} ${candidate.summary}` : `#${candidate.event_id}`}
                      </span>
                      <span className="text-muted" style={{ fontSize: 11.5, marginInlineStart: 8 }}>
                        <CalendarOutlined style={{ marginInlineEnd: 3 }} />
                        {formatTime(candidate.time)}
                      </span>
                      {candidate.model && (
                        <span className="text-muted" style={{ fontSize: 11.5, marginInlineStart: 8 }}>
                          模型：{candidate.model}
                        </span>
                      )}
                      {candidate.operator && (
                        <span className="text-muted" style={{ fontSize: 11.5, marginInlineStart: 8 }}>
                          <UserOutlined style={{ marginInlineEnd: 3 }} />
                          {candidate.operator}
                        </span>
                      )}
                    </span>
                  </Radio>
                ))}
              </div>
            </Radio.Group>
          </div>
        )}
        <Divider style={{ margin: '14px 0 0' }} />
        <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 10, display: 'block' }}>
          归档为当前结论快照，重复归档同一来源不会重复写入；再次归档可覆盖为最新结论。
        </Typography.Text>
      </Modal>
    </>
  );
}
