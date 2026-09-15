import { Card, Empty, Space, Tag } from 'antd';
import { AlertOutlined } from '@ant-design/icons';
import { colors } from '@/theme';
import type { AnalysisAttentionItem } from '@/types';

/** 优先级 → Tag 颜色 */
const LEVEL_COLOR: Record<string, string> = {
  高: 'error',
  中: 'warning',
  低: 'default',
};

/** AI 关注点卡片（含优先级） */
export default function AttentionCard({ attention }: { attention: AnalysisAttentionItem[] }) {
  return (
    <Card
      className="panel"
      styles={{ header: { borderBottom: `1px solid ${colors.border}` } }}
      title={
        <Space>
          <span className="tile-icon-sm" style={{ background: colors.warningLight, color: colors.warning }}>
            <AlertOutlined />
          </span>
          AI 关注点
        </Space>
      }
      extra={<span className="text-muted" style={{ fontSize: 12 }}>{attention.length} 条</span>}
    >
      {attention.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关注点" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {attention.map((item, i) => (
            <div
              key={`${item.title}-${i}`}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.bgSecondary,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>
                  {item.title}
                </span>
                <Tag color={LEVEL_COLOR[item.level] ?? 'default'} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                  {item.level}
                </Tag>
              </div>
              <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
                {item.description}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
