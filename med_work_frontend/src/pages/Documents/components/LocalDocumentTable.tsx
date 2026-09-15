/**
 * 本地知识库列表：展示 med_documents 中的本地文档（本地上传 system + IMA 搬运 ima）。
 * 文档类型筛选由父级「文档管理」左侧菜单控制（docType 受控传入），
 * 本组件提供关键词 / 状态筛选、分页、详情、重新索引与删除。
 * 自管状态，直接调用 services，与「上传任务」抽屉互不干扰。
 */
import {
  App as AntApp,
  Button,
  Dropdown,
  Empty,
  Input,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  FileTextOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { TypeTag } from '@/components';
import { useDictionaryOptions } from '@/hooks';
import { colors } from '@/theme';
import { usePermission } from '@/utils/access';
import {
  deleteDocumentApi,
  listDocumentsApi,
  reindexDocumentApi,
} from '@/services/knowledge';
import {
  DICT_DOC_TYPE,
  DICT_INDEX_STATUS,
  DICT_SOURCE_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
  FALLBACK_INDEX_STATUS_OPTIONS,
  FALLBACK_SOURCE_TYPE_OPTIONS,
} from '@/constants/dictionary';
import type { KnowledgeDocument } from '@/types';
import LocalDocumentDetailDrawer from './LocalDocumentDetailDrawer';

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
  return s ? s.replace('T', ' ').slice(0, 16) : '-';
}

interface LocalDocumentTableProps {
  /** 外部刷新信号（如上传成功），值变化时重新加载列表 */
  refreshKey?: number;
  /** 文档类型筛选（由父级左侧菜单控制；undefined 表示全部） */
  docType?: string;
  /** 类型筛选变化回调（重置时用于清除类型） */
  onDocTypeChange?: (v: string | undefined) => void;
}

export default function LocalDocumentTable({
  refreshKey = 0,
  docType,
  onDocTypeChange,
}: LocalDocumentTableProps) {
  const { message, modal } = AntApp.useApp();
  const can = usePermission();

  // ---------- 字典选项（文档类型 / 索引状态 / 来源分类由字典维护） ----------
  const { labels: docTypeLabels } = useDictionaryOptions(DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS);
  const { options: statusOptions, labels: statusLabels } = useDictionaryOptions(
    DICT_INDEX_STATUS,
    FALLBACK_INDEX_STATUS_OPTIONS,
  );
  // 来源标签仍用于列表「来源」列展示，但不提供来源筛选
  const { labels: sourceTypeLabels } = useDictionaryOptions(
    DICT_SOURCE_TYPE,
    FALLBACK_SOURCE_TYPE_OPTIONS,
  );

  // ---------- 筛选条件（本地独立状态，不污染上传任务抽屉） ----------
  // 输入/选择即查询：keyword 防抖写入，Select 变更直接触发 load
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();

  // ---------- 列表数据 ----------
  const [items, setItems] = useState<KnowledgeDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  // ---------- 详情抽屉 ----------
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDocumentsApi({
        keyword: keyword.trim() || undefined,
        doc_type: docType,
        status,
        page,
        page_size: pageSize,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      message.error('文档列表加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [keyword, docType, status, page, pageSize, message]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // 关键词防抖：停止输入 350ms 后自动查询（输入即搜）
  useEffect(() => {
    const t = window.setTimeout(() => {
      setKeyword(keywordInput);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [keywordInput]);

  // 存在处理中任务时轮询刷新进度
  const hasParsing = useMemo(() => items.some((d) => d.status === 'parsing'), [items]);
  useEffect(() => {
    if (!hasParsing) return;
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [hasParsing, load]);

  /** 查询按钮：立即应用输入框关键词（不等防抖） */
  const handleSearch = useCallback(() => {
    setKeyword(keywordInput);
    setPage(1);
  }, [keywordInput]);

  const handleReset = useCallback(() => {
    setKeywordInput('');
    setKeyword('');
    setStatus(undefined);
    setPage(1);
    onDocTypeChange?.(undefined);
  }, [onDocTypeChange]);

  const confirmDelete = useCallback(
    (doc: KnowledgeDocument) => {
      modal.confirm({
        title: '删除文档',
        content: `确定删除「${doc.title}」吗？将同时清除其向量与分块，且不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteDocumentApi(doc.id);
            message.success(`「${doc.title}」已删除`);
            void load();
          } catch {
            message.error('删除失败，请稍后重试');
          }
        },
      });
    },
    [modal, message, load],
  );

  const handleReindex = async (doc: KnowledgeDocument) => {
    try {
      await reindexDocumentApi(doc.id);
      message.success(`「${doc.title}」已提交重新索引`);
      void load();
    } catch {
      message.error('重新索引提交失败，请稍后重试');
    }
  };

  const columns = [
    {
      title: '文档名称',
      key: 'name',
      render: (_: unknown, r: KnowledgeDocument) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <FileTextOutlined style={{ color: colors.primary, fontSize: 18, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.title}
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {r.file_name}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'doc_type',
      key: 'doc_type',
      width: 104,
      render: (v: string) => <TypeTag type={docTypeLabels[v] ?? v} />,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 104,
      ellipsis: true,
      render: (v: string, r: KnowledgeDocument) =>
        r.source_type === 'ima' ? (
          <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
            {sourceTypeLabels['ima'] ?? 'IMA'}
          </Tag>
        ) : (
          <Tooltip title={v}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {v || '-'}
            </span>
          </Tooltip>
        ),
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 82,
      render: (v: number) => (
        <span className="mono" style={{ fontSize: 12, color: colors.textSecondary }}>
          {formatBytes(v)}
        </span>
      ),
    },
    {
      title: '分块',
      dataIndex: 'chunk_count',
      key: 'chunk_count',
      width: 68,
      render: (v: number) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {v}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 88,
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] ?? 'default'} style={{ marginInlineEnd: 0 }}>
          {statusLabels[v] ?? '处理中'}
        </Tag>
      ),
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 136,
      render: (v: string) => (
        <span className="mono" style={{ fontSize: 12, color: colors.textSecondary }}>
          {formatTime(v)}
        </span>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 56,
      render: (_: unknown, r: KnowledgeDocument) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'detail',
                label: '查看详情',
                icon: <PlayCircleOutlined />,
                onClick: () => setDetailId(r.id),
              },
              ...(can('knowledge_document:update')
                ? [
                    {
                      key: 'reindex',
                      label: '重新索引',
                      icon: <ReloadOutlined />,
                      disabled: r.status === 'parsing',
                      onClick: () => handleReindex(r),
                    },
                  ]
                : []),
              ...(can('knowledge_document:update') || can('knowledge_document:delete')
                ? [{ type: 'divider' as const }]
                : []),
              ...(can('knowledge_document:delete')
                ? [
                    {
                      key: 'delete',
                      label: <span style={{ color: colors.error }}>删除文档</span>,
                      danger: true,
                      onClick: () => confirmDelete(r),
                    },
                  ]
                : []),
            ],
          }}
        >
          <Button type="text" size="small" icon={<MoreOutlined />} />
        </Dropdown>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minWidth: 0 }}>
      {/* 筛选工具栏 */}
      <div className="doc-toolbar">
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索标题 / 文件名"
          allowClear
          style={{ width: 220 }}
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onPressEnter={handleSearch}
        />
        <Select
          placeholder="索引状态"
          allowClear
          style={{ width: 120 }}
          options={statusOptions}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
          查询
        </Button>
        <Button icon={<UndoOutlined />} onClick={handleReset}>
          重置
        </Button>
        {hasParsing && (
          <span className="text-muted" style={{ fontSize: 12 }}>
            存在处理中的文档，列表将自动刷新…
          </span>
        )}
      </div>

      {/* 列表 */}
      <div className="doc-content-scroll">
        <Table
          rowKey="id"
          loading={loading}
          size="middle"
          columns={columns}
          dataSource={items}
          scroll={{ x: 900 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 篇`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无文档，点击右上角「上传文档」添加"
              />
            ),
          }}
        />
      </div>

      <LocalDocumentDetailDrawer docId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
