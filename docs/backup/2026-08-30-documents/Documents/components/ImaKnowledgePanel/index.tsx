import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CloudServerOutlined,
  DatabaseOutlined,
  EditOutlined,
  FileExcelOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FolderOutlined,
  GlobalOutlined,
  LinkOutlined,
  MessageOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  getImaKnowledgeBasesApi,
  getImaKnowledgeContentsApi,
  getImaMediaDetailApi,
  searchImaKnowledgeApi,
} from '@/services/knowledge';
import type {
  ImaKnowledgeBase,
  ImaKnowledgeContentResponse,
  ImaKnowledgeItem,
  ImaMediaDetailResponse,
  ImaSearchHit,
} from '@/types';
import { colors } from '@/theme';

interface ImaKnowledgePanelProps {
  style?: CSSProperties;
  /** 当前浏览的知识库 ID；为空时显示检索模式 */
  kbId?: string | null;
  /** 当前浏览的文件夹 ID（带 folder_ 前缀）；空表示知识库根目录 */
  folderId?: string | null;
  /** 目录导航回调：folderId 为空表示回到知识库根目录 */
  onNavigate?: (kbId: string, folderId?: string | null) => void;
}

const { Paragraph } = Typography;

/** media_type → 图标/颜色/名称 */
const MEDIA_META: Record<number, { icon: ReactNode; color: string; label: string }> = {
  1: { icon: <FilePdfOutlined />, color: '#f5222d', label: 'PDF' },
  2: { icon: <GlobalOutlined />, color: '#1677ff', label: '网页' },
  3: { icon: <FileWordOutlined />, color: '#2f54eb', label: 'Word' },
  4: { icon: <FilePptOutlined />, color: '#fa8c16', label: 'PPT' },
  5: { icon: <FileExcelOutlined />, color: '#52c41a', label: 'Excel' },
  6: { icon: <MessageOutlined />, color: '#07c160', label: '公众号' },
  7: { icon: <FileMarkdownOutlined />, color: '#722ed1', label: 'Markdown' },
  9: { icon: <FileTextOutlined />, color: '#eb2f96', label: '图片' },
  11: { icon: <EditOutlined />, color: '#13c2c2', label: '笔记' },
  12: { icon: <MessageOutlined />, color: '#eb2f96', label: 'AI 会话' },
  13: { icon: <FileTextOutlined />, color: '#595959', label: 'TXT' },
  14: { icon: <FileTextOutlined />, color: '#8c8c8c', label: '思维导图' },
  20: { icon: <GlobalOutlined />, color: '#1677ff', label: 'HTML' },
  21: { icon: <FileTextOutlined />, color: '#a0d911', label: 'EPUB' },
  99: { icon: <FolderOutlined />, color: '#f0a020', label: '文件夹' },
};

const MEDIA_META_DEFAULT = { icon: <FileTextOutlined />, color: '#595959', label: '文件' };

export default function ImaKnowledgePanel({ style, kbId, folderId, onNavigate }: ImaKnowledgePanelProps) {
  // ---------- 检索模式状态 ----------
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [kbList, setKbList] = useState<ImaKnowledgeBase[]>([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbError, setKbError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [kbName, setKbName] = useState<string | undefined>(undefined);
  const [hits, setHits] = useState<ImaSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ---------- 目录浏览模式状态 ----------
  const [contents, setContents] = useState<ImaKnowledgeContentResponse | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  // ---------- 文件详情弹窗状态 ----------
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ImaMediaDetailResponse | null>(null);
  const [detailTitle, setDetailTitle] = useState('');

  const browsing = Boolean(kbId);

  const loadKbList = useCallback(async () => {
    setKbLoading(true);
    setKbError(null);
    try {
      const res = await getImaKnowledgeBasesApi();
      setConfigured(res.configured);
      setKbList(res.items);
      if (res.error) setKbError(res.error);
    } catch {
      setConfigured(false);
      setKbError('无法访问 IMA 服务，请稍后重试');
    } finally {
      setKbLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!browsing) loadKbList();
  }, [browsing, loadKbList]);

  // 目录浏览：随 kbId/folderId 变化加载
  useEffect(() => {
    if (!kbId) {
      setContents(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    getImaKnowledgeContentsApi(kbId, folderId ?? undefined)
      .then((res) => {
        if (cancelled) return;
        setContents(res);
        if (res.error) setContentError(res.error);
      })
      .catch(() => {
        if (cancelled) return;
        setContents(null);
        setContentError('加载目录失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kbId, folderId]);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchImaKnowledgeApi(keyword.trim(), kbName || undefined);
      setHits(res.hits);
      setSearched(true);
      if (res.error) setSearchError(res.error);
    } catch {
      setHits([]);
      setSearched(true);
      setSearchError('检索请求失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  const handleNavigate = (targetFolderId?: string | null) => {
    if (kbId && onNavigate) onNavigate(kbId, targetFolderId);
  };

  /** 打开文件详情：异步取回原文/笔记正文后弹窗展示 */
  const openDetail = async (mediaId: string, title: string) => {
    if (!mediaId) return;
    setDetailTitle(title || '（无标题）');
    setDetail(null);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await getImaMediaDetailApi(mediaId);
      setDetail(res);
    } catch {
      setDetail({ configured: true, media_id: mediaId, media_type: null, content: '', truncated: false, url: '', note_id: '', error: '加载详情失败，请稍后重试' });
    } finally {
      setDetailLoading(false);
    }
  };

  // 面包屑：知识库根 + current_path
  const breadcrumbItems = [
    {
      title: (
        <span
          style={{ cursor: 'pointer' }}
          onClick={() => handleNavigate(null)}
        >
          {contents?.current_path?.[0]?.name || '知识库'}
        </span>
      ),
    },
    ...(contents?.current_path?.slice(1).map((node, i, arr) => ({
      title:
        i === arr.length - 1 ? (
          <span>{node.name}</span>
        ) : (
          <span style={{ cursor: 'pointer' }} onClick={() => handleNavigate(node.media_id)}>
            {node.name}
          </span>
        ),
    })) ?? []),
  ];

  const renderBrowseContent = () => {
    if (contentLoading) {
      return (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      );
    }
    if (contentError) {
      return <Alert type="error" showIcon style={{ margin: '12px 14px' }} message={contentError} />;
    }
    const items = contents?.items ?? [];
    if (items.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="该目录下暂无内容"
          style={{ padding: 40 }}
        />
      );
    }
    // 文件夹在前，文档在后
    const folders = items.filter((i) => i.is_folder);
    const files = items.filter((i) => !i.is_folder);
    const rows = [...folders, ...files];
    return (
      <List
        dataSource={rows}
        renderItem={(item: ImaKnowledgeItem) => {
          const meta = item.is_folder ? MEDIA_META[99] : MEDIA_META[item.media_type] ?? MEDIA_META_DEFAULT;
          // 文件夹进入下一层，文件打开详情弹窗
          const isClickable = item.is_folder ? Boolean(onNavigate) : Boolean(item.media_id);
          return (
            <List.Item
              style={{
                padding: '10px 14px',
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (isClickable) e.currentTarget.style.background = 'rgba(22,119,255,0.04)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              onClick={() => {
                if (item.is_folder) {
                  if (onNavigate) handleNavigate(item.media_id);
                  return;
                }
                void openDetail(item.media_id, item.title);
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, width: '100%' }}>
                <span style={{ color: meta.color, fontSize: 20, flexShrink: 0 }}>{meta.icon}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title || '（无标题）'}
                  </div>
                  <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {meta.label}
                    {item.is_folder && item.file_number > 0 && ` · ${item.file_number} 个文件`}
                    {item.is_folder && item.folder_number > 0 && ` · ${item.folder_number} 个子文件夹`}
                  </div>
                </div>
                {item.is_folder ? (
                  <Tag color="orange" style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                    文件夹
                  </Tag>
                ) : (
                  <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }} color="blue">
                    {meta.label}
                  </Tag>
                )}
              </div>
            </List.Item>
          );
        }}
      />
    );
  };

  return (
    <Card
      className="doc-ima"
      style={{ ...style, display: 'flex', flexDirection: 'column' }}
      styles={{
        body: { padding: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
        header: { flexShrink: 0 },
      }}
      title={
        browsing ? undefined : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CloudServerOutlined style={{ color: colors.primary, fontSize: 18 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Ima 知识库</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                腾讯 ima.qq.com OpenAPI 外部集成
              </div>
            </div>
          </div>
        )
      }
      extra={configured === false ? <Tag color="orange">未配置</Tag> : undefined}
    >
      {configured === false && !browsing && (
        <Alert
          type="warning"
          showIcon
          style={{ margin: '12px 14px' }}
          message="IMA 集成未配置"
          description="请在 med_work_backend/.env 中配置 IMA_OPENAPI_CLIENTID 与 IMA_OPENAPI_APIKEY 后重启后端服务。"
        />
      )}

      {browsing ? (
        /* ---------- 目录浏览模式 ---------- */
        <div className="doc-ima-browse">
          <div className="doc-ima-bar">
            <Breadcrumb items={breadcrumbItems} />
            <Tag style={{ marginLeft: 'auto' }} color="blue">
              {contents?.items?.filter((i) => !i.is_folder).length ?? 0} 个文件
            </Tag>
          </div>
          <div className="doc-ima-scroll">{renderBrowseContent()}</div>
        </div>
      ) : (
        /* ---------- 检索模式（默认） ---------- */
        <>
          {(kbError || searchError) && (
            <Alert
              type="error"
              showIcon
              style={{ margin: '12px 14px' }}
              message={kbError || searchError}
            />
          )}

          {/* 检索区 */}
          <div className="doc-ima-bar">
            <Input
              prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
              placeholder="检索 IMA 知识库内容，如：高血压用药指南"
              allowClear
              style={{ width: 320 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={handleSearch}
            />
            <Select
              placeholder="全部知识库"
              style={{ width: 200 }}
              allowClear
              value={kbName}
              onChange={(v) => setKbName(v)}
              options={kbList.map((kb) => ({ value: kb.name, label: kb.name }))}
            />
            <Button type="primary" icon={<FileSearchOutlined />} loading={searching} onClick={handleSearch}>
              检索
            </Button>
          </div>

          <div className="doc-ima-scroll">
          {/* 检索结果 */}
          {searched && (
            <div style={{ padding: '0 14px 16px' }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
                检索结果{' '}
                <span className="text-muted" style={{ fontWeight: 400 }}>
                  共 {hits.length} 条
                </span>
              </div>
              {searching ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Spin />
                </div>
              ) : hits.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="未检索到相关内容"
                  style={{ padding: 20 }}
                />
              ) : (
                <List
                  itemLayout="vertical"
                  dataSource={hits}
                  renderItem={(hit, index) => (
                    <List.Item
                      key={hit.media_id ?? `${hit.knowledge_base}-${index}`}
                      style={{ padding: '12px 0' }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        <span
                          style={{
                            cursor: hit.media_id ? 'pointer' : 'default',
                            textDecoration: 'none',
                          }}
                          onClick={() => {
                            if (hit.media_id) void openDetail(hit.media_id, hit.title);
                          }}
                          onMouseEnter={(e) => {
                            if (hit.media_id) e.currentTarget.style.textDecoration = 'underline';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.textDecoration = 'none';
                          }}
                        >
                          {hit.title || '（无标题）'}
                        </span>
                        {hit.knowledge_base && (
                          <Tag style={{ marginLeft: 8 }} color="blue">
                            {hit.knowledge_base}
                          </Tag>
                        )}
                      </div>
                      {hit.snippet && (
                        <Paragraph
                          type="secondary"
                          style={{ margin: '6px 0 0', fontSize: 12 }}
                          ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                        >
                          {hit.snippet}
                        </Paragraph>
                      )}
                      {hit.url && (
                        <a href={hit.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                          <LinkOutlined /> 在 IMA 中查看
                        </a>
                      )}
                    </List.Item>
                  )}
                />
              )}
            </div>
          )}

          {/* 知识库列表 */}
          <div style={{ padding: '0 14px 16px' }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
              已关联的 IMA 知识库{' '}
              <span className="text-muted" style={{ fontWeight: 400 }}>
                {kbList.length} 个
              </span>
            </div>
            {kbLoading ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin />
              </div>
            ) : kbList.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={configured === false ? '配置后即可关联' : '暂无知识库'}
                style={{ padding: 12 }}
              />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 12,
                }}
              >
                {kbList.map((kb) => (
                  <div
                    key={kb.id}
                    style={{
                      border: '1px solid rgba(0,0,0,0.06)',
                      borderRadius: 10,
                      padding: '14px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      <DatabaseOutlined style={{ color: colors.primary }} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {kb.name}
                      </span>
                    </div>
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                      ID：{kb.id}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        </>
      )}

      {/* ---------- 文件详情弹窗 ---------- */}
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
                void navigator.clipboard.writeText(detail.content).then(() => message.success('已复制正文'));
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
                <span className="text-muted" style={{ fontSize: 12 }}>
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
    </Card>
  );
}
