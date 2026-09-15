/**
 * 本地文档详情抽屉：元信息 + 分块列表（对接 /api/knowledge/documents/{id}）。
 */
import { Alert, Descriptions, Drawer, Empty, List, Spin, Tag } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';

import { TypeTag } from '@/components';
import { useDictionaryOptions } from '@/hooks';
import { colors } from '@/theme';
import { getDocumentDetailApi } from '@/services/knowledge';
import {
  DICT_DOC_TYPE,
  DICT_INDEX_STATUS,
  DICT_SOURCE_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
  FALLBACK_INDEX_STATUS_OPTIONS,
  FALLBACK_SOURCE_TYPE_OPTIONS,
} from '@/constants/dictionary';
import type { DocumentDetailResponse } from '@/types';

/** 索引状态 → Tag 颜色（颜色是 UI 关注点，不进字典） */
const STATUS_COLOR: Record<string, string> = {
  uploaded: 'default',
  ready: 'success',
  parsing: 'warning',
  failed: 'error',
};

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(s: string): string {
  return s ? s.replace('T', ' ').slice(0, 19) : '-';
}

interface LocalDocumentDetailDrawerProps {
  /** 当前查看的文档 ID；null 时抽屉关闭 */
  docId: number | null;
  onClose: () => void;
}

export default function LocalDocumentDetailDrawer({
  docId,
  onClose,
}: LocalDocumentDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetailResponse | null>(null);

  // 字典选项：类型 / 状态 / 来源分类
  const { labels: docTypeLabels } = useDictionaryOptions(DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS);
  const { labels: statusLabels } = useDictionaryOptions(DICT_INDEX_STATUS, FALLBACK_INDEX_STATUS_OPTIONS);
  const { labels: sourceTypeLabels } = useDictionaryOptions(DICT_SOURCE_TYPE, FALLBACK_SOURCE_TYPE_OPTIONS);

  useEffect(() => {
    if (docId == null) {
      setDetail(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    (async () => {
      try {
        const res = await getDocumentDetailApi(docId);
        if (alive) setDetail(res);
      } catch {
        if (alive) setError('文档详情加载失败，请稍后重试');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId]);

  const doc = detail?.document ?? null;

  return (
    <Drawer
      title={doc?.title ?? '文档详情'}
      open={docId != null}
      onClose={onClose}
      width={760}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : !doc ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Descriptions
            size="small"
            column={2}
            bordered
            items={[
              {
                key: 'type',
                label: '类型',
                children: <TypeTag type={docTypeLabels[doc.doc_type] ?? doc.doc_type} />,
              },
              {
                key: 'status',
                label: '状态',
                children: (
                  <Tag color={STATUS_COLOR[doc.status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                    {statusLabels[doc.status] ?? '处理中'}
                  </Tag>
                ),
              },
              {
                key: 'file',
                label: '文件名',
                span: 2,
                children: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <FileTextOutlined style={{ color: colors.primary }} />
                    {doc.file_name}
                  </span>
                ),
              },
              {
                key: 'source',
                label: '来源',
                children: (
                  <span>
                    {doc.source_type === 'ima' ? (
                      <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                        {sourceTypeLabels['ima'] ?? 'IMA'}
                      </Tag>
                    ) : (
                      doc.source || '-'
                    )}
                  </span>
                ),
              },
              {
                key: 'size',
                label: '大小',
                children: formatBytes(doc.file_size),
              },
              {
                key: 'chunks',
                label: '分块 / 向量',
                children: `${doc.chunk_count} 分块 / ${doc.vector_count} 向量`,
              },
              {
                key: 'uploader',
                label: '上传人',
                children: doc.created_by || '-',
              },
              {
                key: 'time',
                label: '上传时间',
                children: formatTime(doc.created_at),
              },
              {
                key: 'updated',
                label: '更新时间',
                children: formatTime(doc.updated_at),
              },
              ...(doc.remark
                ? [
                    {
                      key: 'remark',
                      label: '备注',
                      span: 2,
                      children: doc.remark,
                    },
                  ]
                : []),
            ]}
          />

          {doc.error_message && (
            <Alert type="error" showIcon message="索引失败原因" description={doc.error_message} />
          )}

          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                marginBottom: 8,
                color: colors.text,
              }}
            >
              文本分块（{detail?.chunks?.length ?? 0}）
            </div>
            {(detail?.chunks?.length ?? 0) === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="该文档暂无文本分块（可能仍在解析或索引失败）"
              />
            ) : (
              <List
                size="small"
                dataSource={detail?.chunks ?? []}
                renderItem={(chunk) => (
                  <List.Item style={{ alignItems: 'flex-start' }}>
                    <div style={{ width: '100%' }}>
                      {chunk.title && (
                        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
                          {chunk.title}
                        </div>
                      )}
                      <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        分块 #{chunk.chunk_index} · {chunk.char_count} 字
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          lineHeight: 1.7,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: colors.textSecondary,
                          maxHeight: 120,
                          overflow: 'auto',
                        }}
                      >
                        {chunk.content}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
