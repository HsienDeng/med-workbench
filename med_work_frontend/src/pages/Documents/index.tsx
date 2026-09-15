import { Button, Menu } from 'antd';
import {
  BarChartOutlined,
  CloudOutlined,
  FolderOpenOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useCallback, useMemo, useState } from 'react';

import { PageHead } from '@/components';
import PermGate from '@/components/PermGate';
import { useDictionaryOptions } from '@/hooks';
import { DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS } from '@/constants/dictionary';
import UploadDocumentModal from '@/pages/Knowledge/components/UploadDocumentModal';
import { useKnowledgeStore } from '@/stores/knowledge';
import DocOverview from './components/DocOverview';
import ImaBrowser from './components/ImaBrowser';
import LocalDocumentTable from './components/LocalDocumentTable';
import UploadTasksModal from './components/UploadTasksModal';
import './index.css';

type DocView = 'overview' | 'local' | 'ima';

/** 左侧菜单点击 key → 视图与文档类型筛选 */
function parseMenuKey(key: string): { view: DocView; docType?: string } | null {
  if (key === 'overview') return { view: 'overview' };
  if (key === 'ima') return { view: 'ima' };
  if (key === 'local:all') return { view: 'local', docType: undefined };
  if (key.startsWith('local:')) return { view: 'local', docType: key.slice('local:'.length) };
  return null;
}

/**
 * 文档管理（知识库总览已并入）：
 * - 概览：KPI + 文档构成 + 知识质量看板
 * - 本地知识库：本地上传 / IMA 搬运到本地的文档列表，上传链路保持不变
 * - IMA 查询：IMA 云端知识库仅做查询与浏览（外部内容，可登记到本地）
 */
export default function Documents() {
  const [tasksOpen, setTasksOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [view, setView] = useState<DocView>('overview');
  const [docType, setDocType] = useState<string | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const { loadOverview } = useKnowledgeStore();
  const { options: docTypeOptions } = useDictionaryOptions(
    DICT_DOC_TYPE,
    FALLBACK_DOC_TYPE_OPTIONS,
  );

  /** 左侧菜单：「本地知识库」展开为文档类型子项，点击即筛选对应类型 */
  const menuItems = useMemo(
    () => [
      { key: 'overview', label: '概览', icon: <BarChartOutlined /> },
      {
        key: 'local',
        label: '本地知识库',
        icon: <FolderOpenOutlined />,
        children: [
          { key: 'local:all', label: '全部文档' },
          ...docTypeOptions.map((o) => ({ key: `local:${o.value}`, label: o.label })),
        ],
      },
      { key: 'ima', label: 'IMA 查询', icon: <CloudOutlined /> },
    ],
    [docTypeOptions],
  );

  /** 选中项：本地知识库下高亮当前类型（默认「全部文档」） */
  const selectedKeys = useMemo(
    () => (view === 'local' ? [`local:${docType ?? 'all'}`] : [view]),
    [view, docType],
  );

  const handleMenuClick = useCallback(({ key }: { key: string }) => {
    const parsed = parseMenuKey(key);
    if (!parsed) return;
    setView(parsed.view);
    setDocType(parsed.docType);
  }, []);

  /** 上传成功：关闭弹窗并刷新本地列表与总览 */
  const handleUploadSuccess = useCallback(() => {
    setUploadOpen(false);
    setRefreshKey((k) => k + 1);
    void loadOverview();
  }, [loadOverview]);

  return (
    <div className="doc-page">
      <PageHead
        crumbs={[]}
        title="文档管理"
        subtitle="知识库概览与文档全生命周期管理"
        dense
        actions={
          view !== 'ima' && (
            <>
              <PermGate code="knowledge_document:upload">
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  onClick={() => setUploadOpen(true)}
                >
                  上传文档
                </Button>
              </PermGate>
              <Button icon={<UnorderedListOutlined />} onClick={() => setTasksOpen(true)}>
                上传任务
              </Button>
            </>
          )
        }
      />

      <div className="doc-layout">
        <div className="doc-sider">
          <Menu
            mode="inline"
            selectedKeys={selectedKeys}
            defaultOpenKeys={['local']}
            onClick={handleMenuClick}
            onOpenChange={(keys) => {
              // 展开「本地知识库」分组时即切换到本地视图
              if (keys.includes('local')) setView('local');
            }}
            items={menuItems}
          />
        </div>

        <div className="doc-content">
          {view === 'overview' && <DocOverview />}
          {view === 'local' && (
            <LocalDocumentTable
              refreshKey={refreshKey}
              docType={docType}
              onDocTypeChange={setDocType}
            />
          )}
          {view === 'ima' && <ImaBrowser />}
        </div>
      </div>

      <UploadTasksModal open={tasksOpen} onClose={() => setTasksOpen(false)} />

      <UploadDocumentModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={handleUploadSuccess}
      />
    </div>
  );
}
