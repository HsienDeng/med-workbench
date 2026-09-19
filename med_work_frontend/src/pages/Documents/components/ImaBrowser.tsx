/**
 * IMA 查询浏览器：仅做查询与显示（IMA 为外部云端知识库）。
 * - 左侧：知识库切换（含个人/共享/订阅库）+ IMA 文件夹树（懒加载）
 * - 右侧：文件夹内文件浏览 / 语义检索结果（限定当前选中的知识库）
 * 支持把 IMA 文件登记到本地（两步式导入第一步，后续在「上传任务」中开始索引）。
 */
import { Alert, Button, Card, Input, Select, Spin, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getImaKnowledgeBasesApi,
  getImaKnowledgeContentsApi,
  searchImaKnowledgeApi,
} from '@/services/knowledge';
import type {
  ImaKnowledgeBase,
  ImaKnowledgeContentResponse,
  ImaSearchHit,
} from '@/types';
import ImaFileList from './ImaFileList';
import ImaFolderTree from './ImaFolderTree';

/** 默认选中的 IMA 知识库名称，不存在时回退第一个 */
const IMA_KB_NAME = 'MedWorkbench';

/** 知识库类型 → 短标签/颜色（订阅库高亮） */
function kbTag(baseType?: string | null): { text: string; color: string } | null {
  if (!baseType) return null;
  if (baseType.includes('订阅')) return { text: '订阅', color: 'geekblue' };
  if (baseType.includes('共享')) return { text: '共享', color: 'blue' };
  if (baseType.includes('个人')) return { text: '个人', color: 'default' };
  return null;
}

export default function ImaBrowser() {
  // ---------- 知识库定位 ----------
  const [kbList, setKbList] = useState<ImaKnowledgeBase[]>([]);
  const [imaKb, setImaKb] = useState<ImaKnowledgeBase | null>(null);
  const [kbLoading, setKbLoading] = useState(true);
  const [kbError, setKbError] = useState<string | null>(null);

  // ---------- 目录浏览 ----------
  const [contents, setContents] = useState<ImaKnowledgeContentResponse | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // ---------- 语义检索 ----------
  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<ImaSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [imaMode, setImaMode] = useState<'browse' | 'search'>('browse');

  // 进入页面：加载自己的知识库（过滤掉订阅库——订阅库 IMA 不开放原文，
  // 取正文/详情都会报 220030，没有实际使用价值）。默认选中绑定的库。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getImaKnowledgeBasesApi('', 20);
        if (!alive) return;
        const ownKbs = res.items.filter((k) => !k.base_type?.includes('订阅'));
        setKbList(ownKbs);
        const kb =
          ownKbs.find((i) => i.name === IMA_KB_NAME) ?? ownKbs[0] ?? null;
        setImaKb(kb);
        if (!kb) setKbError('未找到可用的 IMA 知识库');
      } catch {
        if (alive) setKbError('IMA 知识库加载失败，请检查服务与凭证配置');
      } finally {
        if (alive) setKbLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 切换知识库：清空目录与检索状态，树与目录随 imaKb 变化重新加载
  const handleChangeKb = useCallback(
    (kbId: string) => {
      const kb = kbList.find((k) => k.id === kbId) ?? null;
      if (!kb || kb.id === imaKb?.id) return;
      setCurrentFolderId(null);
      setContents(null);
      setKeyword('');
      setHits([]);
      setSearchError(null);
      setImaMode('browse');
      setImaKb(kb);
    },
    [kbList, imaKb],
  );

  const loadContents = useCallback(
    async (folderId: string | null) => {
      if (!imaKb) return;
      setBrowseLoading(true);
      setBrowseError(null);
      try {
        const res = await getImaKnowledgeContentsApi(imaKb.id, folderId ?? undefined);
        const items = res.items ?? [];
        const fileCount = items.filter((i) => !i.is_folder).length;
        const firstFolder = items.find((i) => i.is_folder);

        // 根目录本身没有文件时自动进入第一个子文件夹，避免打开页面看到空白
        if (folderId === null && fileCount === 0 && firstFolder) {
          setCurrentFolderId(firstFolder.media_id);
          setContents(null);
          const sub = await getImaKnowledgeContentsApi(imaKb.id, firstFolder.media_id);
          setContents(sub);
          setBrowseError(sub.error ?? null);
          return;
        }

        setContents(res);
        setBrowseError(res.error ?? null);
      } catch {
        setBrowseError('目录加载失败，请重试');
      } finally {
        setBrowseLoading(false);
      }
    },
    [imaKb],
  );

  // 知识库就绪后加载根目录
  useEffect(() => {
    if (imaKb) void loadContents(null);
  }, [imaKb, loadContents]);

  const handleSelectFolder = useCallback(
    (folderId: string | null) => {
      setCurrentFolderId(folderId);
      setImaMode('browse');
      void loadContents(folderId);
    },
    [loadContents],
  );

  const handleSearch = useCallback(async () => {
    const q = keyword.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      // 限定在当前选中的知识库内检索
      const res = await searchImaKnowledgeApi(q, imaKb?.name, 20);
      setHits(res.hits ?? []);
      setSearchError(res.error ?? null);
      setImaMode('search');
    } catch {
      setSearchError('检索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  }, [keyword, imaKb]);

  const backToBrowse = useCallback(() => {
    setKeyword('');
    setHits([]);
    setSearchError(null);
    setImaMode('browse');
  }, []);

  // 当前目录的文件（右侧只展示文件，文件夹由左侧树承载）
  const files = useMemo(
    () => (contents?.items ?? []).filter((i) => !i.is_folder),
    [contents],
  );

  const bodyLoading = imaMode === 'browse' ? browseLoading : searching;
  const bodyError = imaMode === 'browse' ? browseError : searchError;

  return (
    <div className="doc-body">
      {/* 左侧：知识库选择 + IMA 文件夹树 */}
      <Card
        className="doc-side"
        title={
          <Select
            style={{ width: '100%' }}
            placeholder="选择知识库"
            value={imaKb?.id}
            loading={kbLoading}
            onChange={handleChangeKb}
            options={kbList.map((kb) => {
              const tag = kbTag(kb.base_type);
              return {
                value: kb.id,
                label: (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={kb.name}
                    >
                      {kb.name}
                    </span>
                    {tag && <Tag color={tag.color} style={{ marginInlineEnd: 0 }}>{tag.text}</Tag>}
                  </span>
                ),
              };
            })}
          />
        }
      >
        {kbLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : imaKb ? (
          <div className="doc-side-tree">
            <ImaFolderTree
              kbId={imaKb.id}
              kbName={imaKb.name}
              onSelectFolder={handleSelectFolder}
              selectedFolderId={currentFolderId}
            />
          </div>
        ) : null}
      </Card>

      {/* 右侧：搜索框 + 文件列表 / 检索结果 */}
      <Card className="doc-main">
        <div className="doc-toolbar">
          <Input
            prefix={<SearchOutlined />}
            placeholder="输入关键词，在 IMA 知识库中语义检索"
            allowClear
            style={{ width: 320 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void handleSearch()}
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={searching}
            disabled={!keyword.trim()}
            onClick={() => void handleSearch()}
          >
            检索
          </Button>
          {imaMode === 'search' && (
            <Button onClick={backToBrowse}>返回浏览</Button>
          )}
          {kbError && <Alert type="warning" showIcon title={kbError} />}
        </div>
        <div className="doc-content-scroll">
          <ImaFileList
            mode={imaMode}
            files={files}
            hits={hits}
            loading={bodyLoading}
            error={bodyError}
          />
        </div>
      </Card>
    </div>
  );
}
