import type { ChatMessageInput } from '@/services/chat';
import type { XMessage } from './useXChat';

export function patchAssistantById(messages: XMessage[], id: string, patch: Partial<XMessage>): XMessage[] {
  const index = messages.findIndex((message) => message.id === id && message.role === 'assistant');
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = { ...next[index], ...patch };
  return next;
}

export const requestHistory = (messages: XMessage[]): XMessage[] =>
  messages.filter((message) => message.role === 'user' || (message.status === 'done' && !!message.content.trim()));

export const toPersist = (messages: XMessage[]): ChatMessageInput[] =>
  messages
    .filter((message) => message.role === 'user' || message.status === 'done')
    .map(({ role, content, citations }) => ({
      role,
      content,
      citations: citations?.length ? citations : null,
    }));
