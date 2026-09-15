import { Card, Empty, Flex, Space, Spin, Tag, Timeline, Typography } from 'antd';
import {
  CalendarOutlined,
  FileTextOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { colors } from '@/theme';
import { ANALYSIS_TYPES, type PatientTimelineEvent } from '@/types';

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ANALYSIS_TYPES.map((item) => [item.value, item.label]),
);

/** 关注点等级 → Tag 颜色 */
const LEVEL_COLOR: Record<string, string> = {
  高: 'red',
  中: 'orange',
  低: 'blue',
};

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '-';
}

interface PatientTimelineProps {
  events: PatientTimelineEvent[];
  loading: boolean;
  /** 点击病历事件：切到病历详情 Tab 并选中该病历 */
  onOpenRecord: (recordId: number) => void;
}

/**
 * 诊疗时间线：病历记录与 AI 分析按时间合并展示（倒序）。
 * 分析事件直接展开结论摘要 / 关注点 / 循证依据，避免跳转。
 */
export default function PatientTimeline({
  events,
  loading,
  onOpenRecord,
}: PatientTimelineProps) {
  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  if (!events.length) {
    return (
      <Card>
        <Empty description="暂无病历与分析记录" style={{ padding: '72px 0' }} />
      </Card>
    );
  }

  const items = events.map((event) => {
    if (event.event_type === 'medical_record') {
      return {
        dot: <FileTextOutlined style={{ color: colors.primary }} />,
        color: 'blue',
        children: (
          <div
            style={{
              background: '#f7f9fc',
              border: '1px solid #eef1f6',
              borderRadius: 10,
              padding: '10px 14px',
              cursor: event.medical_record_id ? 'pointer' : 'default',
            }}
            onClick={() => event.medical_record_id && onOpenRecord(event.medical_record_id)}
          >
            <Flex align="center" gap={8} wrap="wrap">
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                病历记录
              </Tag>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{event.title}</span>
              <span className="text-muted" style={{ fontSize: 11.5 }}>
                <CalendarOutlined style={{ marginInlineEnd: 4 }} />
                {formatTime(event.time)}
              </span>
            </Flex>
            {event.summary && (
              <div
                className="text-muted"
                style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}
              >
                {event.summary}
              </div>
            )}
          </div>
        ),
      };
    }

    const detail = event.detail;
    const summaryEntries = Object.entries(detail?.summary ?? {});
    const attention = detail?.attention ?? [];
    const evidence = detail?.evidence ?? [];

    return {
      dot: <RobotOutlined style={{ color: colors.ai }} />,
      color: 'purple',
      children: (
        <div
          style={{
            background: '#fbfaff',
            border: '1px solid #f0ecff',
            borderRadius: 10,
            padding: '10px 14px',
          }}
        >
          <Flex align="center" gap={8} wrap="wrap">
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              AI 分析
            </Tag>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>
              {TYPE_LABEL[event.analysis_type] ?? event.analysis_type}
            </span>
            <Tag
              color={event.status === 'done' ? 'green' : 'red'}
              style={{ marginInlineEnd: 0 }}
            >
              {event.status === 'done' ? '成功' : '失败'}
            </Tag>
            <span className="text-muted" style={{ fontSize: 11.5 }}>
              <CalendarOutlined style={{ marginInlineEnd: 4 }} />
              {formatTime(event.time)}
            </span>
          </Flex>

          <div className="text-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            <Space size={12} wrap>
              <span>模型：{event.model || '-'}</span>
              <span>
                <UserOutlined style={{ marginInlineEnd: 4 }} />
                {event.operator || '-'}
              </span>
            </Space>
          </div>

          {event.status !== 'done' ? (
            <div style={{ fontSize: 12.5, marginTop: 8, color: '#cf1322' }}>
              {event.summary || '分析失败'}
            </div>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {summaryEntries.map(([label, value]) => (
                <div key={label}>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 2 }}>
                    {label}
                  </div>
                  <Typography.Paragraph
                    style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}
                    ellipsis={{ rows: 3 }}
                  >
                    {String(value)}
                  </Typography.Paragraph>
                </div>
              ))}

              {attention.length > 0 && (
                <div>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    关注点
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {attention.map((item, index) => (
                      <div key={`${item.title}-${index}`} style={{ fontSize: 12.5 }}>
                        <Tag color={LEVEL_COLOR[item.level] ?? 'default'}>
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
                <div>
                  <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    循证依据
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {evidence.map((item, index) => (
                      <div key={`${item.source}-${index}`} className="text-muted" style={{ fontSize: 12 }}>
                        · {item.source || '未命名来源'}
                        {item.relevance != null ? `（相关度 ${item.relevance}）` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ),
    };
  });

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <CalendarOutlined style={{ color: colors.primary }} />
          <span>诊疗时间线</span>
          <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
            共 {events.length} 个事件（病历 + AI 分析）
          </span>
        </Flex>
      }
    >
      <Timeline items={items} />
    </Card>
  );
}
