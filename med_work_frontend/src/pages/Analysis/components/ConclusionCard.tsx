import { Card, Empty, Space, Tag } from 'antd';
import { RobotOutlined, AimOutlined } from '@ant-design/icons';
import { colors } from '@/theme';
import { ANALYSIS_TYPES } from '@/types';

interface ConclusionCardProps {
  summary: Record<string, string>;
  model: string;
  analysisType: string;
  time: string;
}

/** AI 综合分析结论卡片（病情要点摘要） */
export default function ConclusionCard({ summary, model, analysisType, time }: ConclusionCardProps) {
  const typeLabel = ANALYSIS_TYPES.find((t) => t.value === analysisType)?.label ?? analysisType;
  const entries = Object.entries(summary).filter(([, value]) => value && value.trim());

  return (
    <Card
      className="panel"
      styles={{ header: { borderBottom: `1px solid ${colors.border}` } }}
      title={
        <Space>
          <span className="tile-icon-sm" style={{ background: colors.aiLight, color: colors.ai }}>
            <RobotOutlined />
          </span>
          AI 综合分析结论
        </Space>
      }
      extra={
        <Space size={8}>
          <Tag color="purple" style={{ marginInlineEnd: 0 }}>{model || '—'}</Tag>
          <Tag color="success" style={{ marginInlineEnd: 0 }}>{typeLabel}</Tag>
        </Space>
      }
    >
      {entries.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分析结果" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entries.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                gap: 12,
                padding: 12,
                background: colors.bgSecondary,
                borderRadius: 10,
              }}
            >
              <AimOutlined style={{ color: colors.ai, fontSize: 16, marginTop: 2, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: colors.text }}>{value}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {time && (
        <div className="text-muted" style={{ fontSize: 11, marginTop: 12 }}>
          分析时间 {time}
        </div>
      )}
    </Card>
  );
}
