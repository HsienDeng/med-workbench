/**
 * AI 会话 store（迁移自 med-work-frontend src/stores/conversations.ts，zustand → Pinia）
 */
import { ref } from 'vue';

import { defineStore } from 'pinia';

import {
  createConversation,
  deleteConversation,
  listConversations,
} from '#/api/med/chat';

export interface ConversationItem {
  key: string;
  label: string;
}

/** 查找未使用的草稿会话（标题为「新对话」） */
function findDraftConversation(items: ConversationItem[]) {
  return items.find((item) => item.label === '新对话');
}

/** 侧栏最近会话只展示前 5 个 */
export function visibleConversations(items: ConversationItem[]) {
  return items.slice(0, 5);
}

function toItem(conversation: { id: number; title: string }): ConversationItem {
  return { key: String(conversation.id), label: conversation.title };
}

/** 模块级 Promise，防止并发重复加载 / 重复建草稿 */
let loadPromise: null | Promise<ConversationItem[]> = null;
let draftPromise: null | Promise<ConversationItem> = null;

export const useConversationStore = defineStore('med-conversations', () => {
  const conversations = ref<ConversationItem[]>([]);
  const activeKey = ref('');
  const initialized = ref(false);
  const loadFailed = ref(false);

  async function load(): Promise<ConversationItem[]> {
    if (initialized.value) return conversations.value;
    if (loadPromise) return loadPromise;

    loadFailed.value = false;
    loadPromise = listConversations()
      .then((list) => list.map(toItem))
      .then((items) => {
        conversations.value = items;
        initialized.value = true;
        return items;
      })
      .catch((error) => {
        initialized.value = false;
        loadFailed.value = true;
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  }

  async function ensureDraft(): Promise<ConversationItem> {
    await load();
    const existing = findDraftConversation(conversations.value);
    if (existing) {
      conversations.value = [
        existing,
        ...conversations.value.filter((item) => item.key !== existing.key),
      ];
      activeKey.value = existing.key;
      return existing;
    }
    if (draftPromise) return draftPromise;

    draftPromise = createConversation()
      .then(toItem)
      .then((created) => {
        conversations.value = [created, ...conversations.value];
        activeKey.value = created.key;
        return created;
      })
      .finally(() => {
        draftPromise = null;
      });
    return draftPromise;
  }

  function selectConversation(key: string) {
    activeKey.value = key;
  }

  function renameConversation(key: string, label: string) {
    conversations.value = conversations.value.map((item) =>
      item.key === key ? { ...item, label } : item,
    );
  }

  async function removeConversation(key: string) {
    await deleteConversation(Number(key));
    const rest = conversations.value.filter((item) => item.key !== key);
    if (activeKey.value === key) {
      activeKey.value = rest[0]?.key ?? '';
    }
    conversations.value = rest;
    if (rest.length === 0) await ensureDraft();
  }

  function reset() {
    loadPromise = null;
    draftPromise = null;
    conversations.value = [];
    activeKey.value = '';
    initialized.value = false;
    loadFailed.value = false;
  }

  return {
    activeKey,
    conversations,
    ensureDraft,
    initialized,
    loadConversations: load,
    loadFailed,
    removeConversation,
    renameConversation,
    reset,
    selectConversation,
  };
});
