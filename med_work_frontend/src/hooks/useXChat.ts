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
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ChatCitation } from '@/services/chat';
import { patchAssistantById, requestHistory } from './chatMessageState';

export interface XMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'loading' | 'done' | 'error' | 'stopped';
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
  onRequest: (message: string) => boolean;
  onCancel: () => void;
  setMessages: Dispatch<SetStateAction<XMessage[]>>;
  loading: boolean;
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function useXChat(config: UseXChatConfig): UseXChatResult {
  const [messages, setMessages] = useState<XMessage[]>(config.initialMessages ?? []);
  const [loading, setLoading] = useState(false);
  const activeRequest = useRef<{ id: string; abort: () => void } | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const onRequest = useCallback(
    (raw: string) => {
      const text = (raw ?? '').trim();
      if (!text || activeRequest.current) return false;

      const userMsg: XMessage = { id: genId(), role: 'user', content: text };
      const botMsg: XMessage = { id: genId(), role: 'assistant', content: '', status: 'loading' };
      setMessages((prev) => [...prev, userMsg, botMsg]);

      setLoading(true);
      const controller = new AbortController();
      activeRequest.current = { id: botMsg.id, abort: () => controller.abort() };
      let latestContent = '';
      const isCurrent = () => activeRequest.current?.id === botMsg.id;
      const finish = () => {
        activeRequest.current = null;
        setLoading(false);
      };

      const cancel = config.agent.request(
        { message: text, messages: requestHistory([...messages, userMsg]) },
        {
          signal: controller.signal,
          onUpdate: (full) => {
            if (!isCurrent()) return;
            latestContent = full;
            setMessages((prev) => patchAssistantById(prev, botMsg.id, { content: full }));
          },
          onCitations: (list) => {
            if (isCurrent()) setMessages((prev) => patchAssistantById(prev, botMsg.id, { citations: list }));
          },
          onSuccess: () => {
            if (!isCurrent()) return;
            setMessages((prev) => patchAssistantById(prev, botMsg.id, latestContent.trim()
              ? { status: 'done' }
              : { content: '未收到回复，请重试', status: 'error' }));
            finish();
          },
          onError: (msg) => {
            if (!isCurrent()) return;
            setMessages((prev) =>
              patchAssistantById(prev, botMsg.id, { content: msg || '对话出错，请稍后重试', status: 'error' }),
            );
            finish();
          },
        },
      );

      if (typeof cancel === 'function' && isCurrent()) activeRequest.current!.abort = cancel;
      return true;
    },
    [config.agent, messages],
  );

  const onCancel = useCallback(() => {
    const request = activeRequest.current;
    if (!request) return;
    activeRequest.current = null;
    request.abort();
    setLoading(false);
    setMessages((prev) => patchAssistantById(prev, request.id, { status: 'stopped' }));
  }, []);

  return { messages, onRequest, onCancel, setMessages, loading };
}
