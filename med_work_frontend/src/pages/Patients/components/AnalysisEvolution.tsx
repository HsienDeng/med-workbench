import { useCallback, useEffect, useState } from 'react';
import { Card, Empty, Flex, Spin, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  MinusOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { colors } from '@/theme';
import { ANALYSIS_TYPES, type AnalysisEvolutionResponse } from '@/types';
import { getPatientAnalysisEvolution } from '@/services/patients';

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ANALYSIS_TYPES.map((item) => [item.value, item.label]),
);

/** 关注点等级 → 颜色 */
const LEVEL_COLOR: Record<string, string> = {
  高: 'red',
  中: 'orange',
  低: 'blue',
};

const TREND_META: Record<string, { label: string; color: string; icon?: React.ReactNode }> = {
  up: { label: '加重 ↑', color: 'red', icon: <ArrowUpOutlined /> },
  down: { label: '减轻 ↓', color: 'green', icon: <ArrowDownOutlined /> },
  flat: { label: '持平', color: 'default', icon: <MinusOutlined /> },
  new: { label: '新出现', color: 'purple', icon: <PlusOutlined /> },
};

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

interface AnalysisEvolutionProps {
  patientId: number;
}

/**
 * 分析演变：对比该患者历次 AI 分析中的关注点等级轨迹与诊断结论变化。
 * 数据来自 GET /api/patients/{id}/analysis-evolution。
 */
export default function AnalysisEvolution({ patientId }: AnalysisEvolutionProps) {
  const [data, setData] = useState<AnalysisEvolutionResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPatientAnalysisEvolution(patientId);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  const analyses = data?.analyses ?? [];
  const trend = data?.attention_trend ?? [];
  const diagnosis = data?.diagnosis_timeline ?? [];

  if (!analyses.length) {
    return (
      <Card>
        <Empty description="暂无已完成的分析，暂无法对比演变" style={{ padding: '72px 0' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            完成至少两次 AI 分析后，此处将展示关注点与诊断结论的变化轨迹。
          </Typography.Text>
        </Empty>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <RobotOutlined style={{ color: colors.ai }} />
            <span>关注点变化</span>
            <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
              共 {trend.length} 个关注点，按出现频次排序
            </span>
          </Flex>
        }
      >
        {trend.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="分析结论中暂无结构化关注点"
            style={{ padding: '24px 0' }}
          />
        ) : (
          <Table
            rowKey="title"
            size="small"
            pagination={false}
            dataSource={trend}
            columns={[
              {
                title: '关注点',
                dataIndex: 'title',
                ellipsis: true,
                render: (text: string) => <Typography.Text strong>{text}</Typography.Text>,
              },
              {
                title: '出现',
                dataIndex: 'points',
                align: 'center',
                width: 180,
                render: (_: unknown, row) => {
                  const full = row.points.length;
                  const item = row.points[full - 1];
                  return (
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      共 {full} 次{full > 0 && item && row.latest_level ? ` · ${formatTime(item.time).slice(5)}` : ''}
                    </span>
                  );
                },
              },
              {
                title: '等级轨迹',
                dataIndex: 'points',
                render: (points: { time: string; level: string }[]) => (
                  <Flex gap={4} wrap="wrap">
                    {points.map((point, index) => (
                      <Tooltip key={index} title={formatTime(point.time)}>
                        <Tag color={LEVEL_COLOR[point.level] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                          {point.level || '—'}
                        </Tag>
                      </Tooltip>
                    ))}
                  </Flex>
                ),
              },
              {
                title: '趋势',
                dataIndex: 'trend',
                width: 90,
                render: (value: string) => {
                  const meta = TREND_META[value] ?? TREND_META.flat;
                  return <Tag color={meta.color}>{meta.label}</Tag>;
                },
              },
            ]}
          />
        )}
      </Card>

      <Card
        size="small"
        title={
          <Flex align="center" gap={8}>
            <RobotOutlined style={{ color: colors.ai }} />
            <span>诊断结论演变</span>
            <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
              共 {diagnosis.length} 条
            </span>
          </Flex>
        }
      >
        {diagnosis.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="分析结论中暂无诊断类条目"
            style={{ padding: '24px 0' }}
          />
        ) : (
          <Timeline
            items={diagnosis.map((point, index) => ({
              color: index === diagnosis.length - 1 ? 'green' : 'blue',
              children: (
                <div key={`${point.analysis_id}-${index}`}>
                  <Flex align="center" gap={8} wrap="wrap" style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{point.key}</span>
                    <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                      分析 #{point.analysis_id}
                    </Tag>
                    <span className="text-muted" style={{ fontSize: 11.5 }}>
                      {formatTime(point.time)}
                    </span>
                  </Flex>
                  <Typography.Paragraph
                    style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 0, color: colors.textSecondary }}
                    ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
                  >
                    {point.value}
                  </Typography.Paragraph>
                </div>
              ),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
