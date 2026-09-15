/**
 * AI 对话流式服务
 *
 * 前端不直接调用第三方大模型，而是通过后端 /api/chat/stream 转发。
 * 后端以 SSE（text/event-stream）返回增量片段：每行 `data: <片段>`，
 * 结束标识为 `data: [DONE]`，错误标识为 `data: [ERROR] <信息>`。
 */
import { loadAuth } from './auth-storage';

export type ChatRole = 'user' | 'assistant' | 'system';

/** 知识库引用条目（assistant 消息可携带） */
export interface ChatCitation {
  document_id: number;
  title: string;
  score: number;
  snippet: string;
}

export interface ChatMessageInput {
  role: ChatRole;
  content: string;
  citations?: ChatCitation[] | null;
}

/** 会话列表项（不含消息） */
export interface ChatConversationSummary {
  id: number;
  title: string;
  updated_at?: string | null;
}

/** 会话详情（含消息） */
export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatMessageInput[];
}

/** 带鉴权的 JSON 请求封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = loadAuth()?.token;
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const payload = (await res.json()) as { message?: string; detail?: string };
      message = payload.message || payload.detail || message;
    } catch {
      /* 响应体非 JSON，沿用默认文案 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** 会话列表（按更新时间倒序，当前用户） */
export const listConversations = () =>
  request<ChatConversationSummary[]>('/api/chat/conversations');

/** 会话详情（含消息） */
export const getConversation = (id: number) =>
  request<ChatConversationDetail>(`/api/chat/conversations/${id}`);

/** 创建会话 */
export const createConversation = (title = '新对话') =>
  request<ChatConversationSummary>('/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });

/** 更新会话（标题 / 消息可选更新，消息整存） */
export const updateConversation = (
  id: number,
  patch: { title?: string; messages?: ChatMessageInput[] },
) =>
  request<ChatConversationSummary>(`/api/chat/conversations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

/** 删除会话 */
export const deleteConversation = (id: number) =>
  request<{ ok: boolean }>(`/api/chat/conversations/${id}`, { method: 'DELETE' });

export interface StreamChatOptions {
  signal?: AbortSignal;
  temperature?: number;
  systemPrompt?: string;
  onChunk: (full: string) => void;
  onCitations?: (list: ChatCitation[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export async function streamChat(
  messages: ChatMessageInput[],
  opts: StreamChatOptions,
): Promise<void> {
  const token = loadAuth()?.token;
  let response: Response;
  try {
    response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages,
        temperature: opts.temperature ?? 0.3,
        system_prompt: opts.systemPrompt ?? null,
      }),
      signal: opts.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    opts.onError('无法连接服务，请确认后端已启动');
    return;
  }

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as { message?: string; detail?: string };
      message = payload.message || payload.detail || message;
    } catch {
      /* 响应体非 JSON，沿用默认文案 */
    }
    opts.onError(message);
    return;
  }

  if (!response.body) {
    opts.onError('服务返回为空');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        const dataLine = event
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const data = dataLine.slice(5).trim();
        if (data === '[DONE]') {
          opts.onDone();
          return;
        }
        if (data.startsWith('[ERROR]')) {
          opts.onError(data.slice(7).trim());
          return;
        }
        if (data.startsWith('[CITATIONS]')) {
          // 知识库引用事件：不作为正文渲染
          try {
            const list = JSON.parse(data.slice('[CITATIONS]'.length).trim()) as ChatCitation[];
            if (Array.isArray(list) && list.length) opts.onCitations?.(list);
          } catch {
            /* 引用事件解析失败不影响正文 */
          }
          continue;
        }
        full += data;
        opts.onChunk(full);
      }
    }
    opts.onDone();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    opts.onError('对话连接已中断');
  }
}
