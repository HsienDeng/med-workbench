/**
 * IMA 文件夹树（懒加载）。
 * 展开节点时才请求其下一级子文件夹，已加载的层级缓存复用，避免重复请求。
 * 顶层直接展示知识库根下的文件夹，不显示知识库根（如「MedWorkbench」）节点。
 */
import { Alert, Tree } from 'antd';
import type { TreeDataNode, TreeProps } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { getImaKnowledgeContentsApi } from '@/services/knowledge';
import type { ImaKnowledgeItem } from '@/types';
import { getMediaMeta } from './mediaMeta';

interface ImaFolderTreeProps {
  kbId: string;
  /** 知识库名称（保留字段，不再用于展示根节点标题） */
  kbName: string;
  /** 选中文件夹回调 */
  onSelectFolder: (folderId: string) => void;
  /** 外部受控选中项 */
  selectedFolderId?: string | null;
  style?: CSSProperties;
}

function toNode(item: ImaKnowledgeItem): TreeDataNode {
  const meta = getMediaMeta(item.media_type, true);
  return {
    key: item.media_id,
    title: item.title || '（未命名文件夹）',
    icon: meta.icon,
    // folder_number 为 0 时无下级，不再显示展开箭头
    isLeaf: (item.folder_number ?? 0) === 0,
  };
}

/** 递归定位并更新目标节点的 children */
function patchChildren(
  nodes: TreeDataNode[],
  key: string,
  children: TreeDataNode[],
): TreeDataNode[] {
  return nodes.map((node) => {
    if (String(node.key) === key) {
      return { ...node, children, isLeaf: children.length === 0 };
    }
    if (node.children?.length) {
      return { ...node, children: patchChildren(node.children, key, children) };
    }
    return node;
  });
}

export default function ImaFolderTree({
  kbId,
  onSelectFolder,
  selectedFolderId = null,
  style,
}: ImaFolderTreeProps) {
  const [treeData, setTreeData] = useState<TreeDataNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 已加载层级的缓存：folderKey -> 子文件夹节点
  const cacheRef = useRef<Map<string, TreeDataNode[]>>(new Map());

  // 切换知识库时重建树：顶层直接加载知识库根下的文件夹
  useEffect(() => {
    cacheRef.current.clear();
    setError(null);
    let alive = true;
    (async () => {
      try {
        const res = await getImaKnowledgeContentsApi(kbId, undefined);
        const nodes = (res.items || [])
          .filter((i) => i.is_folder)
          .map(toNode);
        if (!alive) return;
        setTreeData(nodes);
      } catch {
        if (alive) setError('加载文件夹失败，请重试');
      }
    })();
    return () => {
      alive = false;
    };
  }, [kbId]);

  const fetchChildren = useCallback(
    async (folderKey: string): Promise<TreeDataNode[]> => {
      const cached = cacheRef.current.get(folderKey);
      if (cached) return cached;

      const res = await getImaKnowledgeContentsApi(kbId, folderKey);
      const nodes = (res.items || [])
        .filter((i) => i.is_folder)
        .map(toNode);
      cacheRef.current.set(folderKey, nodes);
      return nodes;
    },
    [kbId],
  );

  const onLoadData: TreeProps['loadData'] = async (node) => {
    const folderKey = String(node.key);
    if (cacheRef.current.has(folderKey)) return;
    try {
      const children = await fetchChildren(folderKey);
      setTreeData((prev) => patchChildren(prev, folderKey, children));
      setError(null);
    } catch {
      setError('加载文件夹失败，请重试');
    }
  };

  const handleSelect: TreeProps['onSelect'] = (keys) => {
    const key = keys[0];
    if (key === undefined) return;
    onSelectFolder(String(key));
  };

  if (error) {
    return (
      <div style={style}>
        <Alert type="error" showIcon title={error} />
      </div>
    );
  }

  return (
    <div style={style}>
      <Tree
        treeData={treeData}
        loadData={onLoadData}
        onSelect={handleSelect}
        selectedKeys={selectedFolderId ? [selectedFolderId] : []}
        blockNode
        showIcon
      />
    </div>
  );
}
