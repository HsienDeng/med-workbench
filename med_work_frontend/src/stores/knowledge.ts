import { create } from 'zustand';
import {
  deleteDocumentApi,
  getKnowledgeOverviewApi,
  listDocumentsApi,
  reindexDocumentApi,
  startDocumentIndexApi,
  uploadDocumentApi,
} from '@/services/knowledge';
import type { KnowledgeDocument, KnowledgeOverview } from '@/types';

interface ListQuery {
  keyword?: string;
  doc_type?: string;
  status?: string;
  source_type?: string;
  page: number;
  page_size: number;
}

interface KnowledgeStore {
  overview: KnowledgeOverview | null;
  overviewLoading: boolean;
  documents: KnowledgeDocument[];
  total: number;
  listLoading: boolean;
  query: ListQuery;
  setQuery: (patch: Partial<ListQuery>) => void;
  loadOverview: () => Promise<void>;
  loadDocuments: () => Promise<void>;
  uploadDocument: (params: {
    file: File;
    title?: string;
    doc_type?: string;
    sub_type?: string;
    source?: string;
    remark?: string;
  }) => Promise<KnowledgeDocument>;
  deleteDocument: (id: number) => Promise<void>;
  reindexDocument: (id: number) => Promise<void>;
  /** 为「未索引」的 IMA 文档启动索引 */
  startDocumentIndex: (id: number) => Promise<void>;
}

export const useKnowledgeStore = create<KnowledgeStore>((set, get) => ({
  overview: null,
  overviewLoading: false,
  documents: [],
  total: 0,
  listLoading: false,
  // 不限定 source_type：上传任务同时展示本地上传（system）与 IMA 搬运（ima）文档
  query: { page: 1, page_size: 10 },
  setQuery: (patch) => set({ query: { ...get().query, ...patch } }),
  loadOverview: async () => {
    set({ overviewLoading: true });
    try {
      const overview = await getKnowledgeOverviewApi();
      set({ overview, overviewLoading: false });
    } catch {
      set({ overviewLoading: false });
    }
  },
  loadDocuments: async () => {
    const { query } = get();
    set({ listLoading: true });
    try {
      const data = await listDocumentsApi(query);
      set({ documents: data.items, total: data.total, listLoading: false });
    } catch {
      set({ listLoading: false });
    }
  },
  uploadDocument: async (params) => {
    const res = await uploadDocumentApi(params);
    await get().loadOverview();
    return res.document;
  },
  deleteDocument: async (id) => {
    await deleteDocumentApi(id);
    await get().loadDocuments();
    await get().loadOverview();
  },
  reindexDocument: async (id) => {
    await reindexDocumentApi(id);
    await get().loadDocuments();
    await get().loadOverview();
  },
  startDocumentIndex: async (id) => {
    await startDocumentIndexApi(id);
    await get().loadDocuments();
    await get().loadOverview();
  },
}));
