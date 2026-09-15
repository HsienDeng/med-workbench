import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Table, Input, Select, Button, Dropdown, Tooltip, Menu, Tag, App as AntApp } from 'antd';
import type { MenuProps } from 'antd';
import {
  SearchOutlined,
  UploadOutlined,
  MoreOutlined,
  ReloadOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  CloudServerOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { PageHead, TypeTag } from '@/components';
import { colors } from '@/theme';
import { useKnowledgeStore } from '@/stores/knowledge';
import { DOC_TYPE_SHORT } from '@/pages/Knowledge';
import { getImaKnowledgeBasesApi, getImaKnowledgeContentsApi } from '@/services/knowledge';
import type { ImaKnowledgeBase, ImaKnowledgeItem, KnowledgeDocument } from '@/types';
import UploadDocumentModal from '@/pages/Knowledge/components/UploadDocumentModal';
import DocumentDetailDrawer from './components/DocumentDetailDrawer';
import ImaKnowledgePanel from './components/ImaKnowledgePanel';
import './index.css';

type LibKey = 'system' | 'ima';

/** 系统知识库子菜单前缀：system:<doc_type|all> */
const SYSTEM_MENU_PREFIX = 'system:';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'ready', label: '已索引' },
  { value: 'parsing', label: '处理中' },
  { value: 'failed', label: '失败' },
];

const STATUS_TAG: Record<string, { text: string; color: string }> = {
  ready: { text: '已索引', color: 'success' },
  parsing: { text: '处理中', color: 'warning' },
  failed: { text: '失败', color: 'error' },
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

const DOC_TABS = [
  { key: '', label: '全部类型' },
  { key: 'guide', label: '临床指南' },
  { key: 'literature', label: '医学文献' },
  { key: 'drug', label: '药品说明书' },
  { key: 'case', label: '疑难病例' },
  { key: 'norm', label: '院内规范' },
  { key: 'other', label: '其他' },
];

export default function Documents() {
  const { message } = AntApp.useApp();
  const { documents, total, listLoading, query, setQuery, loadDocuments, deleteDocument, reindexDocument, overview, loadOverview } =
    useKnowledgeStore();
  const [activeLib, setActiveLib] = useState<LibKey>('system');
  const [keywordInput, setKeywordInput] = useState(query.keyword ?? '');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [detailDoc, setDetailDoc] = useState<KnowledgeDocument | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // ---------- IMA 知识库目录菜单（绑定 MedWorkbench 知识库的文件夹） ----------
  const [imaKb, setImaKb] = useState<ImaKnowledgeBase | null>(null);
  const [imaRootFolders, setImaRootFolders] = useState<ImaKnowledgeItem[]>([]);
  const [imaSubFolders, setImaSubFolders] = useState<Record<string, ImaKnowledgeItem[]>>({});
  const [openKeys, setOpenKeys] = useState<string[]>(['system', 'ima']);
  const openKeysRef = useRef<string[]>(['system', 'ima']);
  const [selectedImaKey, setSelectedImaKey] = useState('ima');
  const [browseFolderId, setBrowseFolderId] = useState<string | null>(null);

  // ---------- 表格区域高度自适应：让表格内部滚动，最大化纵向空间利用率 ----------
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(320);
  useEffect(() => {
    if (activeLib !== 'system') return;
    const el = tableWrapRef.current;
    if (!el) return;
    const compute = () => {
      // 预留表头(≈39) + 分页(≈64) + 边框缓冲
      setTableScrollY(Math.max(140, el.clientHeight - 110));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [activeLib]);

  // 定位 MedWorkbench 知识库并加载其根目录文件夹
  const loadImaTargetKb = useCallback(async () => {
    try {
      const res = await getImaKnowledgeBasesApi('MedWorkbench', 20);
      const kb = res.items.find((i) => i.name === 'MedWorkbench') ?? res.items[0] ?? null;
      if (!kb) return;
      setImaKb(kb);
      const contents = await getImaKnowledgeContentsApi(kb.id);
      setImaRootFolders(contents.items.filter((i) => i.is_folder));
    } catch {
      /* 菜单保持可用，忽略错误 */
    }
  }, []);

  // 懒加载文件夹下的子文件夹
  const loadImaSubFolders = useCallback(async (folderId: string) => {
    if (!imaKb || imaSubFoldersRef.current[folderId]) return;
    try {
      const res = await getImaKnowledgeContentsApi(imaKb.id, folderId);
      const folders = res.items.filter((i) => i.is_folder);
      imaSubFoldersRef.current = { ...imaSubFoldersRef.current, [folderId]: folders };
      setImaSubFolders(imaSubFoldersRef.current);
    } catch {
      /* ignore */
    }
  }, [imaKb]);
  const imaSubFoldersRef = useRef<Record<string, ImaKnowledgeItem[]>>({});

  // 递归构建文件夹子菜单（key: ima:folder:<folder_id>）
  const buildFolderChildren = useCallback(
    (folders: ImaKnowledgeItem[]): MenuProps['items'] =>
      folders.map((f) => {
        const kids = imaSubFolders[f.media_id] ?? [];
        return {
          key: `ima:folder:${f.media_id}`,
          label: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FolderOutlined style={{ color: '#f0a020', fontSize: 13 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.title}
              </span>
              {f.file_number > 0 && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {f.file_number}
                </span>
              )}
            </span>
          ),
          children: kids.length ? buildFolderChildren(kids) : undefined,
        };
      }),
    [imaSubFolders],
  );

  // Ima 分类下的子菜单：MedWorkbench 的文件夹
  const imaSubMenuItems = useMemo<MenuProps['items']>(() => {
    if (imaRootFolders.length === 0) return undefined;
    return buildFolderChildren(imaRootFolders);
  }, [imaRootFolders, buildFolderChildren]);

  // 进入页面时加载 MedWorkbench 及其文件夹
  useEffect(() => {
    loadImaTargetKb();
  }, [loadImaTargetKb]);

  // 菜单点击：Ima（知识库根目录）/ 文件夹 或 system:<doc_type|all>
  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'ima') {
      setActiveLib('ima');
      setSelectedImaKey('ima');
      setBrowseFolderId(null);
      setOpenKeys((prev) => Array.from(new Set([...prev, 'ima'])) as string[]);
      return;
    }
    const folderMatch = key.match(/^ima:folder:(.+)$/);
    if (folderMatch) {
      setActiveLib('ima');
      setSelectedImaKey(key);
      setBrowseFolderId(folderMatch[1]);
      return;
    }
    setActiveLib('system');
    const docType = key === `${SYSTEM_MENU_PREFIX}all` ? undefined : key.slice(SYSTEM_MENU_PREFIX.length);
    const patch: Partial<{ doc_type?: string; source_type: string; page: number }> = {
      doc_type: docType,
      source_type: 'system',
      page: 1,
    };
    setQuery(patch);
  };

  // 菜单展开时懒加载文件夹的子文件夹
  const handleOpenChange = (keys: string[]) => {
    const prev = openKeysRef.current;
    setOpenKeys(keys);
    openKeysRef.current = keys;
    const newly = keys.filter((k) => !prev.includes(k));
    newly.forEach((k) => {
      const folderMatch = k.match(/^ima:folder:(.+)$/);
      if (folderMatch) loadImaSubFolders(folderMatch[1]);
    });
  };

  // 右侧目录浏览导航（点击面包屑 / 文件夹项），同步左侧选中项
  const handleImaNavigate = useCallback((_kbId: string, folderId?: string | null) => {
    setBrowseFolderId(folderId ?? null);
    setSelectedImaKey(folderId ? `ima:folder:${folderId}` : 'ima');
  }, []);

  // 进入页时拉取全量 doc_type 分布（用于左侧菜单角标，不受当前 doc_type 筛选影响）
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // 各 doc_type 的全量计数（来自 overview，切换分类时不会清零）
  const typeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    (overview?.doc_type_distribution ?? []).forEach((d) => {
      map[d.doc_type] = d.count;
    });
    return map;
  }, [overview]);

  // 左侧目录：系统知识库（含 doc_type 子分类）+ Ima
  const menuItems = useMemo(
    () => [
      {
        key: 'system',
        icon: <DatabaseOutlined />,
        label: '系统知识库',
        children: DOC_TABS.map((t) => ({
          key: `${SYSTEM_MENU_PREFIX}${t.key || 'all'}`,
          label: (
            <span>
              {t.label}
              <span className="text-muted" style={{ marginLeft: 6, fontSize: 12 }}>
                {t.key === '' ? (overview?.total_documents ?? 0) : typeCounts[t.key] ?? 0}
              </span>
            </span>
          ),
        })),
      },
      {
        key: 'ima',
        icon: <CloudServerOutlined />,
        label: 'Ima',
        children: imaSubMenuItems,
      },
    ],
    [overview, typeCounts, imaSubMenuItems],
  );

  // 当前选中项：Ima 目录或 system:<doc_type|all>
  const selectedKey =
    activeLib === 'ima' ? selectedImaKey : `${SYSTEM_MENU_PREFIX}${query.doc_type || 'all'}`;

  useEffect(() => {
    loadDocuments();
  }, [query, loadDocuments]);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => {
      if (keywordInput !== (query.keyword ?? '')) {
        setQuery({ keyword: keywordInput, page: 1 });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [keywordInput, query.keyword, setQuery]);

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
      message.success(`「${doc.title}」已重新索引`);
    } finally {
      setActingId(null);
    }
  };

  const columns = [
    {
      title: '文档名称',
      dataIndex: 'file_name',
      key: 'file_name',
      render: (_: unknown, r: KnowledgeDocument) => (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onClick={() => {
            setDetailDoc(r);
            setDetailOpen(true);
          }}
        >
          <FileTextOutlined style={{ color: colors.primary, fontSize: 18 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
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
      width: 96,
      render: (v: string) => <TypeTag type={DOC_TYPE_SHORT[v] ?? v} />,
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 88,
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
      width: 96,
      render: (v: number) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {v} chunks
        </span>
      ),
    },
    {
      title: '索引进度',
      key: 'progress',
      width: 96,
      render: (_: unknown, r: KnowledgeDocument) => {
        if (r.status === 'ready') return <CheckCircleOutlined style={{ color: colors.success }} />;
        if (r.status === 'failed')
          return (
            <Tooltip title={r.error_message || '索引失败，可点击重新索引'}>
              <CloseCircleOutlined style={{ color: colors.error }} />
            </Tooltip>
          );
        return <Tag color="warning" style={{ marginInlineEnd: 0 }}>处理中</Tag>;
      },
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 132,
      render: (v: string) => (
        <span className="mono" style={{ fontSize: 12, color: colors.textSecondary }}>
          {formatTime(v)}
        </span>
      ),
    },
    {
      title: '上传人',
      dataIndex: 'created_by',
      key: 'created_by',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 84,
      render: (v: string) => {
        const m = STATUS_TAG[v] ?? STATUS_TAG.parsing;
        return (
          <Tag color={m.color} style={{ marginInlineEnd: 0 }}>
            {m.text}
          </Tag>
        );
      },
    },
    {
      title: '',
      key: 'action',
      width: 76,
      render: (_: unknown, r: KnowledgeDocument) => (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'reindex',
                label: '重新索引',
                disabled: r.status === 'parsing',
                onClick: () => handleReindex(r),
              },
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
    <div className="doc-page">
      <PageHead
        crumbs={[{ label: 'MedAI Workbench' }, { label: '知识库' }, { label: '文档管理', current: true }]}
        title="文档管理"
        dense
        actions={
          activeLib === 'system' ? (
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
              上传文档
            </Button>
          ) : undefined
        }
      />

      <div className="doc-body">
        {/* 左侧目录：系统知识库（含类型子分类）/ Ima */}
        <Card className="doc-side">
          <div className="doc-side-menu">
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              openKeys={openKeys}
              onOpenChange={handleOpenChange}
              onClick={handleMenuClick}
              items={menuItems}
              style={{ border: 'none' }}
            />
          </div>
        </Card>

        {/* 右侧内容 */}
        {activeLib === 'system' ? (
          <Card className="doc-main">
            <div className="doc-toolbar">
              <Input
                prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
                placeholder="搜索文档名称 / 标题"
                allowClear
                style={{ width: 240 }}
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
              />
              <Select
                placeholder="全部状态"
                style={{ width: 120 }}
                value={query.status ?? ''}
                onChange={(v) => setQuery({ status: v || undefined, page: 1 })}
                options={STATUS_OPTIONS}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  setKeywordInput('');
                  setQuery({ keyword: undefined, doc_type: undefined, status: undefined, page: 1 });
                }}
              >
                重置
              </Button>
            </div>
            <div className="doc-table-wrap" ref={tableWrapRef}>
              <Table
                rowKey="id"
                loading={listLoading}
                size="middle"
                columns={columns}
                dataSource={documents}
                scroll={{ x: 1040, y: tableScrollY }}
                pagination={{
                  current: query.page,
                  pageSize: query.page_size,
                  total,
                  showTotal: (t) => (
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      共 {t} 个文档
                    </span>
                  ),
                  showSizeChanger: false,
                  onChange: (page) => setQuery({ page }),
                }}
              />
            </div>
          </Card>
        ) : (
          <ImaKnowledgePanel
            style={{ flex: 1, minWidth: 0 }}
            kbId={imaKb?.id ?? null}
            folderId={browseFolderId}
            onNavigate={handleImaNavigate}
          />
        )}
      </div>

      <UploadDocumentModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          setQuery({ page: 1 });
        }}
      />

      <DocumentDetailDrawer
        doc={detailDoc}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
