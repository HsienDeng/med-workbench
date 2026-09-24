/**
 * AI 对话状态机（迁移自 med-work-frontend useXChat）：
 *  - 维护消息数组（用户/助手/思考/引用/状态）；
 *  - 通过 agent.request 启动流式对话，patchAssistantById 增量更新；
 *  - onCancel 中断当前请求并将消息标记为 stopped。
 *
 * 真正的模型调用由调用方实现 agent.request 注入（流式从后端 /api/chat/stream 转发）。
 */
import { ref } from 'vue';

import type { ChatCitation } from '#/api/med/chat';

export type ChatMessageStatus = 'done' | 'error' | 'loading' | 'stopped';

export interface ChatMessage {
  citations?: ChatCitation[];
  content: string;
  id: string;
  role: 'assistant' | 'user';
  status?: ChatMessageStatus;
  thinking?: string;
}

export interface ChatAgentCallbacks {
  onCitations?: (list: ChatCitation[]) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
  onThinking?: (full: string) => void;
  onUpdate: (full: string) => void;
  signal?: AbortSignal;
}

export interface ChatAgent {
  request: (
    info: { message: string; messages: ChatMessage[] },
    callbacks: ChatAgentCallbacks,
  ) => void | (() => void);
}

export interface UseChatConfig {
  agent: ChatAgent;
  initialMessages?: ChatMessage[];
}

const genId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function patchAssistantById(
  list: ChatMessage[],
  id: string,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  const index = list.findIndex((m) => m.id === id && m.role === 'assistant');
  if (index < 0) return list;
  const next = list.slice();
  next[index] = { ...next[index]!, ...patch };
  return next;
}

export function useChat(config: UseChatConfig) {
  const messages = ref<ChatMessage[]>(config.initialMessages ?? []);
  const loading = ref(false);
  let activeRequest: { abort: () => void; id: string } | null = null;

  function dispose() {
    if (!activeRequest) return;
    const req = activeRequest;
    activeRequest = null;
    req.abort();
  }

  function onCancel() {
    if (!activeRequest) return;
    const id = activeRequest.id;
    dispose();
    loading.value = false;
    messages.value = patchAssistantById(messages.value, id, { status: 'stopped' });
  }

  function setMessages(next: ChatMessage[]) {
    messages.value = next;
  }

  function onRequest(raw: string): boolean {
    const text = (raw ?? '').trim();
    if (!text || activeRequest) return false;

    const userMsg: ChatMessage = { content: text, id: genId(), role: 'user' };
    const botMsg: ChatMessage = {
      content: '',
      id: genId(),
      role: 'assistant',
      status: 'loading',
    };
    const newList = [...messages.value, userMsg, botMsg];
    messages.value = newList;

    loading.value = true;
    let latestContent = '';
    const controller = new AbortController();
    activeRequest = { abort: () => controller.abort(), id: botMsg.id };
    const isCurrent = () => activeRequest?.id === botMsg.id;
    const finish = () => {
      activeRequest = null;
      loading.value = false;
    };

    const cancel = config.agent.request(
      { message: text, messages: newList.slice(0, -1) },
      {
        onCitations: (list) => {
          if (isCurrent())
            messages.value = patchAssistantById(messages.value, botMsg.id, {
              citations: list,
            });
        },
        onError: (msg) => {
          if (!isCurrent()) return;
          messages.value = patchAssistantById(messages.value, botMsg.id, {
            content: msg || '对话出错，请稍后重试',
            status: 'error',
          });
          finish();
        },
        onSuccess: () => {
          if (!isCurrent()) return;
          messages.value = patchAssistantById(
            messages.value,
            botMsg.id,
            latestContent.trim()
              ? { status: 'done' }
              : { content: '未收到回复，请重试', status: 'error' },
          );
          finish();
        },
        onThinking: (full) => {
          if (isCurrent())
            messages.value = patchAssistantById(messages.value, botMsg.id, {
              thinking: full,
            });
        },
        onUpdate: (full) => {
          if (!isCurrent()) return;
          latestContent = full;
          messages.value = patchAssistantById(messages.value, botMsg.id, {
            content: full,
          });
        },
        signal: controller.signal,
      },
    );

    if (typeof cancel === 'function' && isCurrent() && activeRequest) {
      activeRequest.abort = cancel;
    }
    return true;
  }

  return { loading, messages, onCancel, onRequest, setMessages };
}

/** 当前持久化请求历史：用户消息 + 已完成的助手消息 */
export function requestHistory(list: ChatMessage[]): ChatMessage[] {
  return list.filter(
    (m) => m.role === 'user' || (m.status === 'done' && !!m.content.trim()),
  );
}

/** 序列化：剔除 thinking / loading / error，只保留 user 与 done */
export function toPersist(list: ChatMessage[]) {
  return list
    .filter((m) => m.role === 'user' || m.status === 'done')
    .map(({ citations, content, role }) => ({
      citations: citations?.length ? citations : null,
      content,
      role,
    }));
}
