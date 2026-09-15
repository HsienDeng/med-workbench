import { useEffect, useState } from 'react';
import { Drawer, Descriptions, Tag, List, Spin, Empty, Typography, Alert, App as AntApp } from 'antd';
import { FileTextOutlined, DatabaseOutlined } from '@ant-design/icons';
import { getDocumentDetailApi } from '@/services/knowledge';
import { DOC_TYPE_SHORT } from '@/pages/Knowledge';
import type { KnowledgeDocument, DocumentDetailResponse } from '@/types';

interface DocumentDetailDrawerProps {
  doc: KnowledgeDocument | null;
  open: boolean;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(s: string): string {
  return s ? s.replace('T', ' ').slice(0, 16) : '-';
}

const STATUS_TAG: Record<string, { text: string; color: string }> = {
  ready: { text: '已索引', color: 'success' },
  parsing: { text: '处理中', color: 'warning' },
  failed: { text: '失败', color: 'error' },
};

export default function DocumentDetailDrawer({ doc, open, onClose }: DocumentDetailDrawerProps) {
  const { message } = AntApp.useApp();
  const [detail, setDetail] = useState<DocumentDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !doc) return;
    setLoading(true);
    setDetail(null);
    setExpanded(null);
    getDocumentDetailApi(doc.id)
      .then((data) => setDetail(data))
      .catch((err) => {
        message.error(err instanceof Error ? err.message : '加载详情失败');
      })
      .finally(() => setLoading(false));
  }, [open, doc, message]);

  const d = detail?.document ?? doc;

  return (
    <Drawer
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined style={{ color: '#2563eb' }} />
          {doc?.file_name ?? '文档详情'}
        </span>
      }
      width={680}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {d && (
          <>
            <Descriptions
              column={2}
              size="small"
              bordered
              labelStyle={{ width: 90, fontWeight: 600 }}
              items={[
                { key: 'title', label: '名称', children: d.title, span: 2 },
                {
                  key: 'type',
                  label: '分类',
                  children: (
                    <Tag color="blue">{DOC_TYPE_SHORT[d.doc_type] ?? d.doc_type}</Tag>
                  ),
                },
                {
                  key: 'sub_type',
                  label: '子分类',
                  children: d.sub_type ? <Tag>{d.sub_type}</Tag> : <span className="text-muted">-</span>,
                },
                {
                  key: 'status',
                  label: '状态',
                  children: (() => {
                    const m = STATUS_TAG[d.status] ?? STATUS_TAG.parsing;
                    return (
                      <Tag color={m.color} style={{ marginInlineEnd: 0 }}>
                        {m.text}
                      </Tag>
                    );
                  })(),
                },
                { key: 'size', label: '文件大小', children: formatBytes(d.file_size) },
                { key: 'chunks', label: '向量分块', children: `${d.chunk_count} chunks` },
                { key: 'source', label: '来源', children: d.source },
                { key: 'created', label: '上传时间', children: formatTime(d.created_at) },
                { key: 'created_by', label: '上传人', children: d.created_by },
                {
                  key: 'summary',
                  label: '摘要',
                  children: d.summary ?? <span className="text-muted">暂无摘要</span>,
                  span: 2,
                },
                { key: 'remark', label: '备注', children: d.remark ?? <span className="text-muted">-</span>, span: 2 },
              ]}
            />

            {d.status === 'failed' && (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 16 }}
                message="索引失败"
                description={d.error_message ?? '未知原因，可返回列表点击「重新索引」重试'}
              />
            )}

            <div
              style={{
                margin: '20px 0 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              <DatabaseOutlined style={{ color: '#2563eb' }} />
              分块内容（{detail?.chunks.length ?? d.chunk_count} 块）
            </div>

            {detail && detail.chunks.length === 0 ? (
              <Empty description="该文档暂无分块" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                dataSource={detail?.chunks ?? []}
                renderItem={(c) => (
                  <List.Item
                    style={{ display: 'block', padding: '12px 0', borderBlockEnd: '1px dashed #e5e7eb' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {c.title ? (
                          c.title
                        ) : (
                          <span className="text-muted">第 {c.chunk_index + 1} 块</span>
                        )}
                      </Typography.Text>
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        {c.char_count} 字
                      </span>
                    </div>
                    <Typography.Paragraph
                      style={{
                        margin: '6px 0 0',
                        fontSize: 12,
                        color: '#4b5563',
                        whiteSpace: 'pre-wrap',
                        maxHeight: expanded === c.id ? undefined : 96,
                        overflow: 'hidden',
                        cursor: 'pointer',
                      }}
                      ellipsis={expanded !== c.id ? { rows: 4, expandable: false } : false}
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                    >
                      {c.content}
                    </Typography.Paragraph>
                    {expanded === c.id && (
                      <span className="text-muted" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => setExpanded(null)}>
                        收起
                      </span>
                    )}
                  </List.Item>
                )}
              />
            )}
          </>
        )}
      </Spin>
    </Drawer>
  );
}
