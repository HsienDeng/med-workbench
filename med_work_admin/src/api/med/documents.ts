/**
 * 知识库文档服务（/api/knowledge/*）。
 */
import type {
  DocumentDetailResponse,
  DocumentListResponse,
  ImaImportResponse,
  ImaKnowledgeBaseListResponse,
  ImaKnowledgeContentResponse,
  ImaMediaDetailResponse,
  ImaSearchResponse,
  KnowledgeDocument,
  KnowledgeOverview,
  SearchResponse,
} from '#/types/med';

import { downloadFile } from '#/api/med/download';
import { requestClient } from '#/api/request';

export interface ListDocumentsParams {
  doc_type?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
  source_type?: string;
  status?: string;
}

export function getKnowledgeOverviewApi() {
  return requestClient.get<KnowledgeOverview>('/knowledge/overview');
}

/** 下载文档原始文件（attachment 流；文件名以后端返回为准） */
export function downloadDocumentFile(docId: number, fallbackName?: string) {
  return downloadFile(`/api/knowledge/documents/${docId}/download`, fallbackName);
}

export function listDocumentsApi(params: ListDocumentsParams = {}) {
  return requestClient.get<DocumentListResponse>('/knowledge/documents', {
    params: {
      ...params,
      page: params.page ?? 1,
      page_size: params.page_size ?? 10,
    },
  });
}

export function uploadDocumentApi(params: {
  doc_type?: string;
  file: File;
  remark?: string;
  source?: string;
  sub_type?: string;
  title?: string;
}) {
  const form = new FormData();
  form.append('file', params.file);
  if (params.title) form.append('title', params.title);
  if (params.doc_type) form.append('doc_type', params.doc_type);
  if (params.sub_type) form.append('sub_type', params.sub_type);
  if (params.source) form.append('source', params.source);
  if (params.remark) form.append('remark', params.remark);
  return requestClient.post<{ document: KnowledgeDocument; message: string }>(
    '/knowledge/documents/upload',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
}

export function getDocumentDetailApi(id: number) {
  return requestClient.get<DocumentDetailResponse>(
    `/knowledge/documents/${id}`,
  );
}

export function deleteDocumentApi(id: number) {
  return requestClient.delete<{ ok: boolean }>(`/knowledge/documents/${id}`);
}

export function reindexDocumentApi(id: number) {
  return requestClient.post<KnowledgeDocument>(
    `/knowledge/documents/${id}/reindex`,
  );
}

/** 为「未索引」的 IMA 文档启动索引（立即返回，状态转 parsing，靠轮询跟进） */
export function startDocumentIndexApi(id: number) {
  return requestClient.post<KnowledgeDocument>(
    `/knowledge/documents/${id}/index`,
  );
}

export function searchKnowledgeApi(q: string, limit = 10) {
  return requestClient.get<SearchResponse>('/knowledge/search', {
    params: { limit, q },
  });
}

// ---------- IMA 外部集成 ----------

export function getImaKnowledgeBasesApi(query = '', limit = 20) {
  return requestClient.get<ImaKnowledgeBaseListResponse>(
    '/knowledge/ima/knowledge-bases',
    { params: { limit, query } },
  );
}

export function searchImaKnowledgeApi(q: string, kbName?: string, limit = 5) {
  return requestClient.get<ImaSearchResponse>('/knowledge/ima/search', {
    params: { kb_name: kbName, limit, q },
  });
}

/** 浏览 IMA 知识库目录：folderId 为空表示知识库根目录 */
export function getImaKnowledgeContentsApi(kbId: string, folderId?: string) {
  return requestClient.get<ImaKnowledgeContentResponse>(
    `/knowledge/ima/knowledge-bases/${encodeURIComponent(kbId)}/contents`,
    { params: { folder_id: folderId } },
  );
}

/** 查看 IMA 文件详情（取回原文/笔记正文） */
export function getImaMediaDetailApi(mediaId: string) {
  return requestClient.get<ImaMediaDetailResponse>(
    `/knowledge/ima/media/${encodeURIComponent(mediaId)}`,
  );
}

/**
 * 把 IMA 远程文档同步（搬运）到本地知识库：
 * IMA 全文 → RAG 上传接口 → bge 向量化 → Qdrant。
 * 异步执行，返回 submitted=True；进度通过本地文档列表（source_type=ima）观察。
 */
export function importImaMediaApi(params: {
  doc_type?: string;
  mediaId: string;
  title?: string;
}) {
  const form = new FormData();
  if (params.title) form.append('title', params.title);
  form.append('doc_type', params.doc_type ?? 'guide');
  return requestClient.post<ImaImportResponse>(
    `/knowledge/ima/media/${encodeURIComponent(params.mediaId)}/import`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
}
