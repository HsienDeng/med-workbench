/**
 * IMA 文件列表：浏览模式下展示当前文件夹的文件，搜索模式下展示检索结果。
 * 点击条目打开详情弹窗，取回原文 / 笔记正文后展示。
 */
import { CloudDownloadOutlined, LinkOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Empty,
  List,
  Modal,
  Spin,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { useState } from 'react';
import type { CSSProperties } from 'react';

import { getImaMediaDetailApi } from '@/services/knowledge';
import type {
  ImaKnowledgeItem,
  ImaMediaDetailResponse,
  ImaSearchHit,
} from '@/types';
import { getMediaMeta } from './mediaMeta';
import ImaImportModal from './ImaImportModal';
import type { ImaImportItem } from './ImaImportModal';

export type ImaFileListMode = 'browse' | 'search';

interface ImaFileListProps {
  mode: ImaFileListMode;
  /** 浏览模式：当前文件夹下的文件（不含文件夹） */
  files?: ImaKnowledgeItem[];
  /** 搜索模式：检索命中结果 */
  hits?: ImaSearchHit[];
  loading?: boolean;
  error?: string | null;
  style?: CSSProperties;
}

export default function ImaFileList({
  mode,
  files = [],
  hits = [],
  loading = false,
  error = null,
  style,
}: ImaFileListProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ImaMediaDetailResponse | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [importItem, setImportItem] = useState<ImaImportItem | null>(null);

  const openDetail = async (mediaId: string | null, title: string) => {
    if (!mediaId) return;
    setDetailTitle(title || '（无标题）');
    setDetail(null);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await getImaMediaDetailApi(mediaId));
    } catch {
      setDetail({
        configured: true,
        media_id: mediaId,
        media_type: null,
        content: '',
        truncated: false,
        url: '',
        note_id: '',
        error: '加载详情失败，请稍后重试',
      });
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ ...style, textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...style, padding: 16 }}>
        <Alert type="error" showIcon message={error} />
      </div>
    );
  }

  return (
    <div style={style}>
      {mode === 'browse' ? (
        files.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该文件夹暂无文件"
            style={{ marginTop: 64 }}
          />
        ) : (
          <List
            dataSource={files}
            renderItem={(item) => {
              const meta = getMediaMeta(item.media_type);
              return (
                <List.Item
                  style={{ padding: '10px 16px', cursor: 'pointer' }}
                  onClick={() => void openDetail(item.media_id, item.title)}
                  actions={[
                    <Tooltip key="import" title="获取 IMA 全文并向量化存入本地知识库">
                      <Button
                        type="text"
                        size="small"
                        style={{ fontSize: 12 }}
                        icon={<CloudDownloadOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setImportItem(item);
                        }}
                      >
                        检索
                      </Button>
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<span style={{ color: meta.color, fontSize: 20 }}>{meta.icon}</span>}
                    title={
                      <span style={{ fontSize: 13 }}>{item.title || '（无标题）'}</span>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )
      ) : hits.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="未检索到相关内容，试试其他关键词"
          style={{ marginTop: 64 }}
        />
      ) : (
        <List
          dataSource={hits}
          renderItem={(hit) => (
            <List.Item
              style={{ padding: '12px 16px', cursor: hit.media_id ? 'pointer' : 'default' }}
              onClick={() => void openDetail(hit.media_id, hit.title)}
              actions={
                hit.media_id
                  ? [
                      <Tooltip key="import" title="获取全文并向量化存入本地知识库">
                        <Button
                          type="text"
                          size="small"
                          style={{ fontSize: 12 }}
                          icon={<CloudDownloadOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hit.media_id) {
                              setImportItem({ media_id: hit.media_id, title: hit.title });
                            }
                          }}
                        >
                          检索
                        </Button>
                      </Tooltip>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                title={
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {hit.title || '（无标题）'}
                    {hit.knowledge_base && (
                      <Tag color="blue" style={{ marginLeft: 8 }}>
                        {hit.knowledge_base}
                      </Tag>
                    )}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      )}

      <ImaImportModal item={importItem} onClose={() => setImportItem(null)} />

      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        title={detailTitle}
        width={720}
        footer={[
          <Button
            key="copy"
            disabled={!detail?.content}
            onClick={() => {
              if (detail?.content) {
                void navigator.clipboard
                  .writeText(detail.content)
                  .then(() => message.success('已复制正文'));
              }
            }}
          >
            复制正文
          </Button>,
          <Button key="close" type="primary" onClick={() => setDetailOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin tip="正在获取原文…" />
          </div>
        ) : detail?.error ? (
          <Alert type="error" showIcon message={detail.error} />
        ) : detail?.content ? (
          <>
            {detail.truncated && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 10 }}
                message="内容过长，已截断显示"
              />
            )}
            <pre
              style={{
                margin: 0,
                maxHeight: '55vh',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              {detail.content}
            </pre>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                该条目暂无可在线预览的正文
                <br />
                <span style={{ fontSize: 12 }} className="text-muted">
                  部分类型（如微信公众号文章）受平台限制无法抓取，请在 IMA 客户端中查看原文
                </span>
              </span>
            }
          />
        )}

        {detail?.url && (
          <div style={{ marginTop: 12 }}>
            <a href={detail.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              <LinkOutlined /> 在 IMA 中打开原文
            </a>
          </div>
        )}
      </Modal>
    </div>
  );
}
