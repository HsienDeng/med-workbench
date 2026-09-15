/**
 * 上传任务弹窗：展示本地文档（本地上传 + IMA 搬运）列表及索引进度。
 * 存在「处理中」文档时每 3s 自动轮询刷新，直到全部完成 / 失败。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Dropdown,
  Empty,
  Modal,
  Progress,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { TypeTag } from '@/components';
import { useDictionaryOptions } from '@/hooks';
import { colors } from '@/theme';
import { useKnowledgeStore } from '@/stores/knowledge';
import {
  DICT_DOC_TYPE,
  DICT_INDEX_STATUS,
  DICT_SOURCE_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
  FALLBACK_INDEX_STATUS_OPTIONS,
  FALLBACK_SOURCE_TYPE_OPTIONS,
} from '@/constants/dictionary';
import type { KnowledgeDocument } from '@/types';

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

interface UploadTasksModalProps {
  open: boolean;
  onClose: () => void;
}

export default function UploadTasksModal({ open, onClose }: UploadTasksModalProps) {
  const { message } = AntApp.useApp();
  const {
    documents,
    total,
    listLoading,
    query,
    setQuery,
    loadDocuments,
    deleteDocument,
    reindexDocument,
    startDocumentIndex,
    loadOverview,
  } = useKnowledgeStore();
  const [actingId, setActingId] = useState<number | null>(null);

  // 字典选项：类型 / 状态 / 来源分类
  const { labels: docTypeLabels } = useDictionaryOptions(DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS);
  const { labels: statusLabels } = useDictionaryOptions(DICT_INDEX_STATUS, FALLBACK_INDEX_STATUS_OPTIONS);
  const { labels: sourceTypeLabels } = useDictionaryOptions(DICT_SOURCE_TYPE, FALLBACK_SOURCE_TYPE_OPTIONS);

  // 打开时重置为最近上传记录并刷新
  useEffect(() => {
    if (!open) return;
    setQuery({ page: 1, page_size: 10, keyword: undefined, doc_type: undefined, status: undefined });
    void loadDocuments();
    void loadOverview();
    // 打开时重置一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 存在处理中任务时轮询刷新
  const hasParsing = useMemo(
    () => documents.some((d) => d.status === 'parsing'),
    [documents],
  );
  useEffect(() => {
    if (!open || !hasParsing) return;
    const t = window.setInterval(() => {
      void loadDocuments();
      void loadOverview();
    }, 3000);
    return () => window.clearInterval(t);
  }, [open, hasParsing, loadDocuments, loadOverview]);

  const handleDelete = async (doc: KnowledgeDocument) => {
    setActingId(doc.id);
    try {
      await deleteDocument(doc.id);
      message.success(`「${doc.title}」已删除`);
    } finally {
      setActingId(null);
    }
  };

  const handleReindex = async (doc: KnowledgeDocument) => {
    setActingId(doc.id);
    try {
      await reindexDocument(doc.id);
      message.success(`「${doc.title}」已提交重新索引`);
    } finally {
      setActingId(null);
    }
  };

  /** 未索引的 IMA 文档：触发「取回正文 → 切分 → 向量化」 */
  const handleStartIndex = async (doc: KnowledgeDocument) => {
    setActingId(doc.id);
    try {
      await startDocumentIndex(doc.id);
      message.success(`「${doc.title}」已开始索引，请稍候查看进度`);
    } finally {
      setActingId(null);
    }
  };

  const columns = [
    {
      title: '文档名称',
      key: 'name',
      render: (_: unknown, r: KnowledgeDocument) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileTextOutlined style={{ color: colors.primary, fontSize: 18 }} />
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
              {r.file_name}
            </div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {r.title}
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
      width: 100,
      ellipsis: true,
      render: (v: string, r: KnowledgeDocument) =>
        r.source_type === 'ima' ? (
          <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
            {sourceTypeLabels['ima'] ?? 'IMA'}
          </Tag>
        ) : (
          <span className="text-muted" style={{ fontSize: 12 }}>
            {v}
          </span>
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
      title: '向量分块',
      dataIndex: 'chunk_count',
      key: 'chunk_count',
      width: 92,
      render: (v: number) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {v} chunks
        </span>
      ),
    },
    {
      title: '索引进度',
      key: 'progress',
      width: 130,
      render: (_: unknown, r: KnowledgeDocument) => {
        if (r.status === 'ready')
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircleOutlined style={{ color: colors.success }} />
              <span style={{ fontSize: 12, color: colors.textSecondary }}>已完成</span>
            </span>
          );
        if (r.status === 'failed')
          return (
            <Tooltip title={r.error_message || '索引失败，可点击重新索引'}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CloseCircleOutlined style={{ color: colors.error }} />
                <span style={{ fontSize: 12, color: colors.textSecondary }}>失败</span>
              </span>
            </Tooltip>
          );
        if (r.status === 'uploaded')
          return (
            <Tooltip title="已登记，尚未取回内容与向量化，点击右侧「开始索引」">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ClockCircleOutlined style={{ color: colors.textMuted }} />
                <span style={{ fontSize: 12, color: colors.textSecondary }}>未索引</span>
              </span>
            </Tooltip>
          );
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <Progress
              percent={r.vector_count > 0 ? 85 : 40}
              status="active"
              size="small"
              showInfo={false}
              strokeColor={colors.warning}
              style={{ flex: 1, minWidth: 0, margin: 0 }}
            />
            <span style={{ fontSize: 12, color: colors.textSecondary, flexShrink: 0 }}>处理中</span>
          </span>
        );
      },
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 128,
      render: (v: string) => (
        <span className="mono" style={{ fontSize: 12, color: colors.textSecondary }}>
          {formatTime(v)}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] ?? 'default'} style={{ marginInlineEnd: 0 }}>
          {statusLabels[v] ?? '处理中'}
        </Tag>
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
              // 未索引：触发两步式导入的第二步（取回 IMA 内容并向量化）
              ...(r.status === 'uploaded'
                ? [
                    {
                      key: 'start-index',
                      label: '开始索引',
                      icon: <PlayCircleOutlined />,
                      onClick: () => handleStartIndex(r),
                    },
                  ]
                : [
                    {
                      key: 'reindex',
                      label: '重新索引',
                      icon: <ReloadOutlined />,
                      disabled: r.status === 'parsing',
                      onClick: () => handleReindex(r),
                    },
                  ]),
              { type: 'divider' },
              {
                key: 'delete',
                label: <span style={{ color: colors.error }}>删除文档</span>,
                danger: true,
                onClick: () => handleDelete(r),
              },
            ],
          }}
        >
          <Button type="text" size="small" loading={actingId === r.id} icon={<MoreOutlined />} />
        </Dropdown>
      ),
    },
  ];

  return (
    <Modal
      title="上传任务"
      open={open}
      onCancel={onClose}
      width={960}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <span className="text-muted" style={{ fontSize: 12 }}>
            {hasParsing
              ? '部分文档正在向 IMA 取回内容并向量化，列表将自动刷新'
              : `共 ${total} 个文档（IMA 同步）`}
          </span>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadDocuments()}>
            刷新
          </Button>
        </div>
      }
    >
      <Table
        rowKey="id"
        loading={listLoading}
        size="small"
        columns={columns}
        dataSource={documents}
        scroll={{ x: 1080, y: '55vh' }}
        pagination={{
          current: query.page,
          pageSize: query.page_size,
          total,
          showSizeChanger: false,
          onChange: (page) => setQuery({ page }),
        }}
        locale={{
          emptyText: <Empty description="暂无同步记录，可在 IMA 文件详情中点击「同步到本地」" />,
        }}
      />
    </Modal>
  );
}
