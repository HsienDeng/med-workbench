import { create } from 'zustand';
import {
  activateAiProvider,
  createAiProvider,
  deleteAiProvider,
  fetchAiProviderModels,
  getAiProviders,
  testAiProvider,
  updateAiProvider,
} from '@/services/api';
import type {
  AiProviderCreateInput,
  AiProviderItem,
  AiProviderProbeResult,
  AiProviderUpdateInput,
} from '@/types';

/** 每个 provider 的探测结果缓存（测速 / 模型列表共用）。 */
export type ProbeState = AiProviderProbeResult & { testedAt: number };

interface AiProviderStore {
  providers: AiProviderItem[];
  loading: boolean;
  error: string | null;
  /** 正在执行的写操作 provider 标识（按钮级 loading）。 */
  mutating: string | null;
  /** 正在探测的 provider 标识。 */
  probing: string | null;
  probes: Record<string, ProbeState>;
  loadProviders: () => Promise<void>;
  createProvider: (input: AiProviderCreateInput) => Promise<void>;
  updateProvider: (provider: string, input: AiProviderUpdateInput) => Promise<void>;
  removeProvider: (provider: string) => Promise<void>;
  activateProvider: (provider: string) => Promise<void>;
  probeProvider: (provider: string, mode: 'test' | 'models') => Promise<ProbeState | null>;
  clearProbe: (provider: string) => void;
}

export const useAiProviderStore = create<AiProviderStore>((set, get) => ({
  providers: [],
  loading: false,
  error: null,
  mutating: null,
  probing: null,
  probes: {},

  loadProviders: async () => {
    set({ loading: true, error: null });
    try {
      const data = await getAiProviders();
      set({ providers: data, loading: false });
    } catch {
      set({
        providers: [],
        loading: false,
        error: 'AI 供应商配置加载失败，请确认已登录且后端服务可用。',
      });
    }
  },

  createProvider: async (input) => {
    set({ mutating: 'create' });
    try {
      const created = await createAiProvider(input);
      await get().loadProviders();
      return void created;
    } finally {
      set({ mutating: null });
    }
  },

  updateProvider: async (provider, input) => {
    set({ mutating: provider });
    try {
      await updateAiProvider(provider, input);
      await get().loadProviders();
    } finally {
      set({ mutating: null });
    }
  },

  removeProvider: async (provider) => {
    set({ mutating: provider });
    try {
      await deleteAiProvider(provider);
      const probes = { ...get().probes };
      delete probes[provider];
      set({ probes });
      await get().loadProviders();
    } finally {
      set({ mutating: null });
    }
  },

  activateProvider: async (provider) => {
    set({ mutating: provider });
    try {
      await activateAiProvider(provider);
      await get().loadProviders();
    } finally {
      set({ mutating: null });
    }
  },

  probeProvider: async (provider, mode) => {
    set({ probing: provider });
    try {
      const result =
        mode === 'test' ? await testAiProvider(provider) : await fetchAiProviderModels(provider);
      const state: ProbeState = { ...result, testedAt: Date.now() };
      set({ probes: { ...get().probes, [provider]: state } });
      // 成功拉到模型列表时后端会更新 cached_models，同步刷新列表
      if (result.ok && result.models.length > 0) {
        await get().loadProviders();
      }
      return state;
    } finally {
      set({ probing: null });
    }
  },

  clearProbe: (provider) => {
    const probes = { ...get().probes };
    delete probes[provider];
    set({ probes });
  },
}));
