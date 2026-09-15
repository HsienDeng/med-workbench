import { create } from 'zustand';
import {
  batchCreateDictionaryItems,
  createDictionary,
  createDictionaryItem,
  deleteDictionary,
  deleteDictionaryItem,
  getDictionaries,
  getDictionaryCategories,
  getDictionaryItems,
  updateDictionary,
  updateDictionaryItem,
} from '@/services/api';
import type {
  Dictionary,
  DictionaryCategory,
  DictionaryCategoryOption,
  DictionaryItem,
  DictionaryItemPayload,
  DictionaryItemUpdatePayload,
  DictionaryPayload,
  DictionaryStatus,
  DictionaryUpdatePayload,
} from '@/types';

/** 分类标签：后端接口不可用时兜底展示 */
export const DICTIONARY_CATEGORY_OPTIONS: DictionaryCategoryOption[] = [
  { value: 'clinical', label: '临床' },
  { value: 'lab', label: '检验' },
  { value: 'coding', label: '编码体系' },
  { value: 'business', label: '业务' },
];

export const DICTIONARY_CATEGORY_LABELS: Record<DictionaryCategory, string> = {
  clinical: '临床',
  lab: '检验',
  coding: '编码体系',
  business: '业务',
};

interface DictionaryStore {
  categories: DictionaryCategoryOption[];

  // 字典列表
  dictionaries: Dictionary[];
  dictLoading: boolean;
  dictError: string | null;
  dictTotal: number;
  dictPage: number;
  dictPageSize: number;
  keyword: string;
  category: DictionaryCategory | '';
  status: DictionaryStatus | '';

  // 当前选中字典及其字典项
  selectedDictId: number | null;
  items: DictionaryItem[];
  itemLoading: boolean;
  itemError: string | null;
  itemTotal: number;
  itemPage: number;
  itemPageSize: number;
  itemKeyword: string;
  itemStatus: DictionaryStatus | '';

  submitting: boolean;

  loadCategories: () => Promise<void>;
  setKeyword: (keyword: string) => void;
  setCategory: (category: DictionaryCategory | '') => void;
  setStatus: (status: DictionaryStatus | '') => void;
  setDictPage: (page: number, pageSize?: number) => void;
  loadDictionaries: () => Promise<void>;
  createDictionary: (payload: DictionaryPayload) => Promise<Dictionary>;
  updateDictionary: (id: number, payload: DictionaryUpdatePayload) => Promise<Dictionary>;
  removeDictionary: (id: number) => Promise<void>;

  selectDictionary: (id: number | null) => void;
  setItemKeyword: (keyword: string) => void;
  setItemStatus: (status: DictionaryStatus | '') => void;
  setItemPage: (page: number, pageSize?: number) => void;
  loadItems: () => Promise<void>;
  createItem: (dictId: number, payload: DictionaryItemPayload) => Promise<DictionaryItem>;
  batchCreateItems: (dictId: number, text: string) => Promise<number>;
  updateItem: (itemId: number, payload: DictionaryItemUpdatePayload) => Promise<DictionaryItem>;
  removeItem: (itemId: number) => Promise<void>;

  reset: () => void;
}

const initialState = {
  categories: DICTIONARY_CATEGORY_OPTIONS,
  dictionaries: [] as Dictionary[],
  dictLoading: false,
  dictError: null as string | null,
  dictTotal: 0,
  dictPage: 1,
  dictPageSize: 10,
  keyword: '',
  category: '' as DictionaryCategory | '',
  status: '' as DictionaryStatus | '',

  selectedDictId: null as number | null,
  items: [] as DictionaryItem[],
  itemLoading: false,
  itemError: null as string | null,
  itemTotal: 0,
  itemPage: 1,
  itemPageSize: 10,
  itemKeyword: '',
  itemStatus: '' as DictionaryStatus | '',

  submitting: false,
};

export const useDictionaryStore = create<DictionaryStore>((set, get) => ({
  ...initialState,

  loadCategories: async () => {
    try {
      const data = await getDictionaryCategories();
      if (data.length) set({ categories: data });
    } catch {
      set({ categories: DICTIONARY_CATEGORY_OPTIONS });
    }
  },

  setKeyword: (keyword) => set({ keyword, dictPage: 1 }),
  setCategory: (category) => set({ category, dictPage: 1 }),
  setStatus: (status) => set({ status, dictPage: 1 }),
  setDictPage: (page, pageSize) =>
    set((state) => ({
      dictPage: page,
      dictPageSize: pageSize ?? state.dictPageSize,
    })),

  loadDictionaries: async () => {
    const { keyword, category, status, dictPage, dictPageSize } = get();
    set({ dictLoading: true, dictError: null });
    try {
      const data = await getDictionaries({
        keyword: keyword || undefined,
        category: category || undefined,
        status: status || undefined,
        page: dictPage,
        pageSize: dictPageSize,
      });
      set({
        dictionaries: data.items,
        dictTotal: data.total,
        dictLoading: false,
      });
    } catch {
      set({
        dictionaries: [],
        dictTotal: 0,
        dictLoading: false,
        dictError: '字典列表加载失败，请确认已登录且后端服务可用。',
      });
    }
  },

  createDictionary: async (payload) => {
    set({ submitting: true });
    try {
      const created = await createDictionary(payload);
      await get().loadDictionaries();
      return created;
    } finally {
      set({ submitting: false });
    }
  },

  updateDictionary: async (id, payload) => {
    set({ submitting: true });
    try {
      const updated = await updateDictionary(id, payload);
      await get().loadDictionaries();
      return updated;
    } finally {
      set({ submitting: false });
    }
  },

  removeDictionary: async (id) => {
    set({ submitting: true });
    try {
      await deleteDictionary(id);
      const { selectedDictId, dictPage, dictionaries } = get();
      // 删完当前页最后一条时回退一页，避免出现空页
      if (dictionaries.length === 1 && dictPage > 1) set({ dictPage: dictPage - 1 });
      if (selectedDictId === id) set({ selectedDictId: null, items: [], itemTotal: 0 });
      await get().loadDictionaries();
    } finally {
      set({ submitting: false });
    }
  },

  selectDictionary: (id) =>
    set({
      selectedDictId: id,
      itemPage: 1,
      itemKeyword: '',
      itemStatus: '',
      items: [],
      itemTotal: 0,
    }),

  setItemKeyword: (itemKeyword) => set({ itemKeyword, itemPage: 1 }),
  setItemStatus: (itemStatus) => set({ itemStatus, itemPage: 1 }),
  setItemPage: (page, pageSize) =>
    set((state) => ({
      itemPage: page,
      itemPageSize: pageSize ?? state.itemPageSize,
    })),

  loadItems: async () => {
    const { selectedDictId, itemKeyword, itemStatus, itemPage, itemPageSize } = get();
    if (selectedDictId === null) {
      set({ items: [], itemTotal: 0, itemLoading: false });
      return;
    }
    set({ itemLoading: true, itemError: null });
    try {
      const data = await getDictionaryItems(selectedDictId, {
        keyword: itemKeyword || undefined,
        status: itemStatus || undefined,
        page: itemPage,
        pageSize: itemPageSize,
      });
      set({ items: data.items, itemTotal: data.total, itemLoading: false });
    } catch {
      set({
        items: [],
        itemTotal: 0,
        itemLoading: false,
        itemError: '字典项加载失败，请稍后重试。',
      });
    }
  },

  createItem: async (dictId, payload) => {
    set({ submitting: true });
    try {
      const created = await createDictionaryItem(dictId, payload);
      await get().loadItems();
      await get().loadDictionaries();
      return created;
    } finally {
      set({ submitting: false });
    }
  },

  batchCreateItems: async (dictId, text) => {
    set({ submitting: true });
    try {
      const result = await batchCreateDictionaryItems(dictId, text);
      await get().loadItems();
      await get().loadDictionaries();
      return result.created;
    } finally {
      set({ submitting: false });
    }
  },

  updateItem: async (itemId, payload) => {
    set({ submitting: true });
    try {
      const updated = await updateDictionaryItem(itemId, payload);
      await get().loadItems();
      await get().loadDictionaries();
      return updated;
    } finally {
      set({ submitting: false });
    }
  },

  removeItem: async (itemId) => {
    set({ submitting: true });
    try {
      await deleteDictionaryItem(itemId);
      const { items, itemPage } = get();
      if (items.length === 1 && itemPage > 1) set({ itemPage: itemPage - 1 });
      await get().loadItems();
      await get().loadDictionaries();
    } finally {
      set({ submitting: false });
    }
  },

  reset: () => set(initialState),
}));
