/**
 * useXChat —— 兼容 Ant Design X 风格的对话状态钩子
 *
 * 注意：当前 @ant-design/x@2.9.0 并未导出 useXAgent / useXChat，因此这里自行实现一套
 * 等价 API，便于页面以 playground 风格组织代码。真正的模型调用经由后端 /api/chat/stream
 * 转发（前端不直接请求第三方大模型）。
 *
 * 用法：
 *   const agent = { request: ({ messages }, cb) => streamChat(..., cb) };
 *   const { messages, onRequest, onCancel, setMessages, loading } = useXChat({ agent });
 */
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { streamChat, type ChatCitation, type ChatMessageInput } from '@/services/chat';

export interface XMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'loading' | 'done' | 'error';
  citations?: ChatCitation[];
}

export interface XAgentCallbacks {
  signal?: AbortSignal;
  onUpdate: (full: string) => void;
  onCitations?: (list: ChatCitation[]) => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}

export interface XAgent {
  request: (
    info: { message: string; messages: XMessage[] },
    callbacks: XAgentCallbacks,
  ) => void | (() => void);
}

export interface UseXChatConfig {
  agent: XAgent;
  initialMessages?: XMessage[];
}

export interface UseXChatResult {
  messages: XMessage[];
  onRequest: (message: string) => void;
  onCancel: () => void;
  setMessages: Dispatch<SetStateAction<XMessage[]>>;
  loading: boolean;
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const patchLastAssistant = (msgs: XMessage[], patch: Partial<XMessage>): XMessage[] => {
  const copy = [...msgs];
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === 'assistant') {
      copy[i] = { ...copy[i], ...patch };
      break;
    }
  }
  return copy;
};

export function useXChat(config: UseXChatConfig): UseXChatResult {
  const [messages, setMessages] = useState<XMessage[]>(config.initialMessages ?? []);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  const onRequest = useCallback(
    (raw: string) => {
      const text = (raw ?? '').trim();
      if (!text || loading) return;

      const userMsg: XMessage = { id: genId(), role: 'user', content: text };
      const botMsg: XMessage = { id: genId(), role: 'assistant', content: '', status: 'loading' };
      setMessages((prev) => [...prev, userMsg, botMsg]);

      const history: ChatMessageInput[] = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setLoading(true);
      const controller = new AbortController();
      abortRef.current = () => controller.abort();

      const cancel = config.agent.request(
        { message: text, messages: [...messages, userMsg] },
        {
          signal: controller.signal,
          onUpdate: (full) => setMessages((prev) => patchLastAssistant(prev, { content: full })),
          onCitations: (list) =>
            setMessages((prev) => patchLastAssistant(prev, { citations: list })),
          onSuccess: () => {
            setMessages((prev) => patchLastAssistant(prev, { status: 'done' }));
            setLoading(false);
            abortRef.current = null;
          },
          onError: (msg) => {
            setMessages((prev) =>
              patchLastAssistant(prev, { content: msg || '对话出错，请稍后重试', status: 'error' }),
            );
            setLoading(false);
            abortRef.current = null;
          },
        },
      );

      if (typeof cancel === 'function') abortRef.current = cancel;
    },
    [config.agent, loading, messages],
  );

  const onCancel = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setLoading(false);
    setMessages((prev) =>
      patchLastAssistant(prev, {
        content: prev.length ? prev[prev.length - 1]?.content || '已停止生成' : '已停止生成',
        status: 'done',
      }),
    );
  }, []);

  return { messages, onRequest, onCancel, setMessages, loading };
}
