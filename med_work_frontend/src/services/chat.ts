/**
 * AI 对话流式服务
 *
 * 前端不直接调用第三方大模型，而是通过后端 /api/chat/stream 转发。
 * 后端以 SSE（text/event-stream）返回 JSON 事件：每条 `data: {"type": ...}`，
 * type 为 delta（正文增量）/ thinking（推理增量）/ citations（引用）/ done / error。
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
  /** 会话绑定的提示词模板 ID，null=默认助手 */
  prompt_id?: number | null;
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

/** 更新会话（标题 / 提示词 / 消息可选更新，消息整存；promptId 传 0 表示切回默认助手） */
export const updateConversation = (
  id: number,
  patch: { title?: string; promptId?: number; messages?: ChatMessageInput[] },
) => {
  const { promptId, ...rest } = patch;
  return request<ChatConversationSummary>(`/api/chat/conversations/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...rest, prompt_id: promptId }),
  });
};

/** 删除会话 */
export const deleteConversation = (id: number) =>
  request<{ ok: boolean }>(`/api/chat/conversations/${id}`, { method: 'DELETE' });

export interface StreamChatOptions {
  signal?: AbortSignal;
  temperature?: number;
  systemPrompt?: string;
  /** 本轮使用的模型名；为空时由后端按激活 provider 默认模型处理 */
  model?: string;
  onChunk: (full: string) => void;
  /** 推理（思考）过程增量；模型/网关支持时才有 */
  onThinking?: (full: string) => void;
  onCitations?: (list: ChatCitation[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** SSE 事件负载（后端 json.dumps 序列化） */
type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'citations'; list: ChatCitation[] }
  | { type: 'done' }
  | { type: 'error'; message?: string };

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
        model: opts.model ?? null,
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
  let thinking = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        // 兼容多行 data:（SSE 规范中同一事件的多个 data 行需拼接）
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5))
          .join('\n');
        if (!data) continue;
        let parsed: StreamEvent | null = null;
        try {
          parsed = JSON.parse(data) as StreamEvent;
        } catch {
          parsed = null;
        }
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          if (parsed.type === 'done') {
            opts.onDone();
            return;
          }
          if (parsed.type === 'error') {
            opts.onError(parsed.message || '对话出错，请稍后重试');
            return;
          }
          if (parsed.type === 'citations') {
            if (Array.isArray(parsed.list) && parsed.list.length) opts.onCitations?.(parsed.list);
            continue;
          }
          if (parsed.type === 'thinking') {
            thinking += parsed.text;
            opts.onThinking?.(thinking);
            continue;
          }
          if (parsed.type === 'delta') {
            full += parsed.text;
            opts.onChunk(full);
          }
          continue;
        }
        // 兼容旧协议（纯文本 / [DONE] / [ERROR] / [CITATIONS]）
        if (data.trim() === '[DONE]') {
          opts.onDone();
          return;
        }
        if (data.trim().startsWith('[ERROR]')) {
          opts.onError(data.trim().slice(7).trim());
          return;
        }
        if (data.trim().startsWith('[CITATIONS]')) {
          try {
            const list = JSON.parse(data.trim().slice('[CITATIONS]'.length).trim()) as ChatCitation[];
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
