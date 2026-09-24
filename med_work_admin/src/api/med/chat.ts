/**
 * AI 对话服务（/api/chat/*）
 *
 * 会话 CRUD 走 requestClient；流式对话 streamChat 用原生 fetch + ReadableStream
 * 解析后端 SSE（text/event-stream，每条 data: {"type": ...}）。
 * 事件类型：delta（正文增量）/ thinking（推理增量）/ citations（引用）/ done / error。
 */
import { useAccessStore } from '@vben/stores';

import { requestClient } from '#/api/request';

export type ChatRole = 'assistant' | 'system' | 'user';

/** 知识库引用条目（assistant 消息可携带） */
export interface ChatCitation {
  document_id: number;
  score: number;
  snippet: string;
  title: string;
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
  prompt_id?: null | number;
  updated_at?: null | string;
}

/** 会话详情（含消息） */
export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatMessageInput[];
}

/** 会话列表（按更新时间倒序，当前用户） */
export function listConversations() {
  return requestClient.get<ChatConversationSummary[]>('/chat/conversations');
}

/** 会话详情（含消息） */
export function getConversation(id: number) {
  return requestClient.get<ChatConversationDetail>(`/chat/conversations/${id}`);
}

/** 创建会话 */
export function createConversation(title = '新对话') {
  return requestClient.post<ChatConversationSummary>('/chat/conversations', {
    title,
  });
}

/** 更新会话（标题 / 提示词 / 消息可选更新，消息整存；promptId 传 0 表示切回默认助手） */
export function updateConversation(
  id: number,
  patch: { messages?: ChatMessageInput[]; promptId?: number; title?: string },
) {
  const { promptId, ...rest } = patch;
  return requestClient.put<ChatConversationSummary>(
    `/chat/conversations/${id}`,
    { ...rest, prompt_id: promptId },
  );
}

/** 删除会话 */
export function deleteConversation(id: number) {
  return requestClient.delete<{ ok: boolean }>(`/chat/conversations/${id}`);
}

export interface StreamChatOptions {
  /** 推理（思考）过程增量；模型/网关支持时才有 */
  onThinking?: (full: string) => void;
  onChunk: (full: string) => void;
  onCitations?: (list: ChatCitation[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
  /** 本轮使用的模型名；为空时由后端按激活 provider 默认模型处理 */
  model?: string;
  systemPrompt?: string;
  temperature?: number;
}

/** SSE 事件负载（后端 json.dumps 序列化） */
type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'citations'; list: ChatCitation[] }
  | { type: 'done' }
  | { type: 'error'; message?: string };

function getAccessToken(): null | string {
  return useAccessStore().accessToken;
}

export async function streamChat(
  messages: ChatMessageInput[],
  opts: StreamChatOptions,
): Promise<void> {
  const token = getAccessToken();
  let response: Response;
  try {
    response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages,
        model: opts.model ?? null,
        system_prompt: opts.systemPrompt ?? null,
        temperature: opts.temperature ?? 0.3,
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
      const payload = (await response.json()) as {
        detail?: string;
        message?: string;
      };
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
        let parsed: null | StreamEvent = null;
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
            if (Array.isArray(parsed.list) && parsed.list.length > 0) {
              opts.onCitations?.(parsed.list);
            }
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
            const list = JSON.parse(
              data.trim().slice('[CITATIONS]'.length).trim(),
            ) as ChatCitation[];
            if (Array.isArray(list) && list.length > 0) opts.onCitations?.(list);
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
