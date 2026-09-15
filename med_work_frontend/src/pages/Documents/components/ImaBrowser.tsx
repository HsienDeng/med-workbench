/**
 * IMA 查询浏览器：仅做查询与显示（IMA 为外部云端知识库）。
 * - 左侧：IMA 知识库文件夹树（懒加载）
 * - 右侧：文件夹内文件浏览 / 语义检索结果
 * 支持把 IMA 文件登记到本地（两步式导入第一步，后续在「上传任务」中开始索引）。
 */
import { Alert, Button, Card, Input, Spin } from 'antd';
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

/** 绑定的 IMA 知识库名称（优先），未找到时回退第一个知识库 */
const IMA_KB_NAME = 'MedWorkbench';

export default function ImaBrowser() {
  // ---------- 知识库定位 ----------
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

  // 进入页面：定位绑定的知识库
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getImaKnowledgeBasesApi(IMA_KB_NAME, 20);
        if (!alive) return;
        const kb =
          res.items.find((i) => i.name === IMA_KB_NAME) ?? res.items[0] ?? null;
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
      const res = await searchImaKnowledgeApi(q, undefined, 20);
      setHits(res.hits ?? []);
      setSearchError(res.error ?? null);
      setImaMode('search');
    } catch {
      setSearchError('检索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  }, [keyword]);

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
      {/* 左侧：IMA 文件夹树 */}
      <Card className="doc-side" title="">
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
          {kbError && <Alert type="warning" showIcon message={kbError} />}
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
