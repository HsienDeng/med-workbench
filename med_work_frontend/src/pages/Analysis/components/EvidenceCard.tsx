import { useState } from 'react';
import { App as AntApp, Card, Empty, Space, Tag, Button, Typography } from 'antd';
import { DownloadOutlined, FileSearchOutlined } from '@ant-design/icons';
import { colors } from '@/theme';
import type { EvidenceItem } from '@/types';
import { downloadDocumentFile } from '@/services/knowledge';

interface EvidenceCardProps {
  evidence: EvidenceItem[];
}

/** 循证依据卡片（含知识库引用来源，命中知识库时可下载原文） */
export default function EvidenceCard({ evidence }: EvidenceCardProps) {
  const { message } = AntApp.useApp();
  const [downloading, setDownloading] = useState<number | null>(null);

  const avgScore =
    evidence.length > 0
      ? Math.round(
          evidence.reduce((sum, e) => sum + (typeof e.relevance === 'number' ? e.relevance : 0), 0) /
            evidence.length,
        )
      : 0;

  const handleDownload = async (item: EvidenceItem) => {
    if (!item.document_id) return;
    setDownloading(item.document_id);
    try {
      await downloadDocumentFile(item.document_id, `${item.source?.replace(/[《》]/g, '') || '原文'}.pdf`);
      message.success(`已开始下载「${item.source ?? '原文'}」`);
    } catch {
      // 错误提示已由 api.ts 全局处理
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card
      className="panel"
      styles={{ header: { borderBottom: `1px solid ${colors.border}` } }}
      title={
        <Space>
          <span className="tile-icon-sm" style={{ background: colors.primaryLight, color: colors.primary }}>
            <FileSearchOutlined />
          </span>
          循证依据
        </Space>
      }
      extra={
        evidence.length > 0 ? (
          <Space size={8}>
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>{evidence.length} 条来源</Tag>
            <span className="text-muted" style={{ fontSize: 12 }}>平均相关度 {avgScore}%</span>
          </Space>
        ) : null
      }
    >
      {evidence.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次分析未引用外部依据" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {evidence.map((s, i) => (
            <div
              key={`${s.source}-${i}`}
              style={{
                display: 'flex',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: i === 0 ? colors.primaryLight : colors.bgSecondary,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.source || '未命名依据'}</div>
                {s.snippet ? (
                  <Typography.Paragraph
                    type="secondary"
                    style={{ margin: '4px 0 0', fontSize: 12 }}
                    ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                  >
                    {s.snippet}
                  </Typography.Paragraph>
                ) : null}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <Tag color="success" style={{ marginInlineEnd: 0 }}>
                  {typeof s.relevance === 'number' ? `${s.relevance}%` : '-'}
                </Tag>
                {s.document_id ? (
                  <Button
                    type="link"
                    size="small"
                    icon={<DownloadOutlined />}
                    style={{ padding: '0 4px' }}
                    loading={downloading === s.document_id}
                    onClick={() => void handleDownload(s)}
                  >
                    查看原文
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
