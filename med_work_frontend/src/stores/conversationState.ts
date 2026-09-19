export interface ConversationItem {
  key: string;
  label: string;
}

export const findDraftConversation = (items: ConversationItem[]) =>
  items.find((item) => item.label === '新对话');

export const visibleConversations = (items: ConversationItem[]) => items.slice(0, 5);
