import { downloadFile, request } from './api';
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
} from '@/types';

export interface ListDocumentsParams {
  keyword?: string;
  doc_type?: string;
  status?: string;
  source_type?: string;
  page?: number;
  page_size?: number;
}

export function getKnowledgeOverviewApi(): Promise<KnowledgeOverview> {
  return request<KnowledgeOverview>('/api/knowledge/overview');
}

/** 下载文档原始文件（attachment 流；文件名以后端返回为准） */
export function downloadDocumentFile(docId: number, fallbackName?: string): Promise<void> {
  return downloadFile(`/api/knowledge/documents/${docId}/download`, fallbackName);
}

export function listDocumentsApi(params: ListDocumentsParams = {}): Promise<DocumentListResponse> {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.doc_type) query.set('doc_type', params.doc_type);
  if (params.status) query.set('status', params.status);
  if (params.source_type) query.set('source_type', params.source_type);
  query.set('page', String(params.page ?? 1));
  query.set('page_size', String(params.page_size ?? 10));
  const qs = query.toString();
  return request<DocumentListResponse>(`/api/knowledge/documents${qs ? `?${qs}` : ''}`);
}

export function uploadDocumentApi(params: {
  file: File;
  title?: string;
  doc_type?: string;
  sub_type?: string;
  source?: string;
  remark?: string;
}): Promise<{ document: KnowledgeDocument; message: string }> {
  const form = new FormData();
  form.append('file', params.file);
  if (params.title) form.append('title', params.title);
  if (params.doc_type) form.append('doc_type', params.doc_type);
  if (params.sub_type) form.append('sub_type', params.sub_type);
  if (params.source) form.append('source', params.source);
  if (params.remark) form.append('remark', params.remark);
  return request<{ document: KnowledgeDocument; message: string }>(
    '/api/knowledge/documents/upload',
    { method: 'POST', body: form },
  );
}

export function getDocumentDetailApi(id: number): Promise<DocumentDetailResponse> {
  return request<DocumentDetailResponse>(`/api/knowledge/documents/${id}`);
}

export function deleteDocumentApi(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/knowledge/documents/${id}`, { method: 'DELETE' });
}

export function reindexDocumentApi(id: number): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(`/api/knowledge/documents/${id}/reindex`, {
    method: 'POST',
  });
}

/** 为「未索引」的 IMA 文档启动索引（立即返回，状态转 parsing，靠轮询跟进） */
export function startDocumentIndexApi(id: number): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(`/api/knowledge/documents/${id}/index`, {
    method: 'POST',
  });
}

export function searchKnowledgeApi(q: string, limit = 10): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q, limit: String(limit) }).toString();
  return request<SearchResponse>(`/api/knowledge/search?${qs}`);
}

// ---------- IMA 外部集成 ----------

export function getImaKnowledgeBasesApi(
  query = '',
  limit = 20,
): Promise<ImaKnowledgeBaseListResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (query) qs.set('query', query);
  return request<ImaKnowledgeBaseListResponse>(`/api/knowledge/ima/knowledge-bases?${qs.toString()}`);
}

export function searchImaKnowledgeApi(
  q: string,
  kbName?: string,
  limit = 5,
): Promise<ImaSearchResponse> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  if (kbName) qs.set('kb_name', kbName);
  return request<ImaSearchResponse>(`/api/knowledge/ima/search?${qs.toString()}`);
}

/** 浏览 IMA 知识库目录：folderId 为空表示知识库根目录 */
export function getImaKnowledgeContentsApi(
  kbId: string,
  folderId?: string,
): Promise<ImaKnowledgeContentResponse> {
  const qs = new URLSearchParams();
  if (folderId) qs.set('folder_id', folderId);
  const q = qs.toString();
  return request<ImaKnowledgeContentResponse>(
    `/api/knowledge/ima/knowledge-bases/${encodeURIComponent(kbId)}/contents${q ? `?${q}` : ''}`,
  );
}

/** 查看 IMA 文件详情（取回原文/笔记正文） */
export function getImaMediaDetailApi(mediaId: string): Promise<ImaMediaDetailResponse> {
  return request<ImaMediaDetailResponse>(
    `/api/knowledge/ima/media/${encodeURIComponent(mediaId)}`,
  );
}

/**
 * 把 IMA 远程文档同步（搬运）到本地知识库：
 * IMA 全文 → RAG 上传接口 → bge 向量化 → Qdrant。
 * 异步执行，返回 submitted=True；进度通过本地文档列表（source_type=ima）观察。
 */
export function importImaMediaApi(params: {
  mediaId: string;
  title?: string;
  doc_type?: string;
}): Promise<ImaImportResponse> {
  const form = new FormData();
  if (params.title) form.append('title', params.title);
  form.append('doc_type', params.doc_type ?? 'guide');
  return request<ImaImportResponse>(
    `/api/knowledge/ima/media/${encodeURIComponent(params.mediaId)}/import`,
    { method: 'POST', body: form },
  );
}
