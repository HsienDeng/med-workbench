import { create } from 'zustand';
import { getAiConnections, setActiveAiProvider } from '@/services/api';
import type { AIConnectionResponse, ApiConnection, ApiProviderTemplate } from '@/types';

export const API_PROVIDER_TEMPLATES: ApiProviderTemplate[] = [
  {
    provider: 'kimi',
    name: 'Kimi',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-2.6', 'kimi-k2.7-code'],
    defaultModel: 'kimi-2.6',
    accent: '#2D6CDF',
    description: '当前后端病历分析与对话服务已接入。',
  },
  {
    provider: 'o98k',
    name: 'O98K 中转',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.o98k.de/v1',
    models: ['gpt-5.6-sol'],
    defaultModel: 'gpt-5.6-sol',
    accent: '#F97316',
    description: '第三方中转网关，可路由 gpt / claude / deepseek 等模型。',
  },
  {
    provider: 'glm',
    name: 'GLM',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5-air'],
    defaultModel: 'glm-4.6',
    accent: '#8B5CF6',
    description: '适合中文临床摘要与多轮诊疗问答。',
  },
  {
    provider: 'gpt',
    name: 'GPT',
    protocol: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.1', 'gpt-5.1-mini'],
    defaultModel: 'gpt-5.1-mini',
    accent: '#F59E0B',
    description: '国际模型路由，用于跨语言医学推理与评估。',
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    protocol: 'OpenAI Compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    accent: '#EF4444',
    description: '低成本推理通道，支持长上下文分析。',
  },
];

function mapConnection(item: AIConnectionResponse): ApiConnection {
  return {
    id: item.id,
    provider: item.provider,
    name: item.name,
    protocol: item.protocol,
    baseUrl: item.base_url,
    activeModel: item.active_model,
    models: item.models,
    status: item.status,
    enabled: item.enabled,
    hasApiKey: item.has_api_key,
  };
}

interface ApiConnectionStore {
  connections: ApiConnection[];
  loading: boolean;
  switchingProvider: string | null;
  error: string | null;
  loadConnections: () => Promise<void>;
  setActiveProvider: (provider: string) => Promise<void>;
}

export const useApiConnectionStore = create<ApiConnectionStore>((set) => ({
  connections: [],
  loading: false,
  switchingProvider: null,
  error: null,
  loadConnections: async () => {
    set({ loading: true, error: null });
    try {
      const data = await getAiConnections();
      set({ connections: data.map(mapConnection), loading: false });
    } catch {
      set({
        connections: [],
        loading: false,
        error: 'AI 连接配置加载失败，请确认已登录且后端服务可用。',
      });
    }
  },
  setActiveProvider: async (provider) => {
    set({ switchingProvider: provider });
    try {
      await setActiveAiProvider(provider);
      const data = await getAiConnections();
      set({ connections: data.map(mapConnection), error: null });
    } finally {
      set({ switchingProvider: null });
    }
  },
}));
