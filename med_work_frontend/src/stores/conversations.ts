import { create } from 'zustand';
import {
  createConversation,
  deleteConversation,
  listConversations,
} from '@/services/chat';
import { findDraftConversation, type ConversationItem } from './conversationState';

interface ConversationState {
  conversations: ConversationItem[];
  activeKey: string;
  initialized: boolean;
  loadFailed: boolean;
  loadConversations: () => Promise<ConversationItem[]>;
  ensureDraft: () => Promise<ConversationItem>;
  selectConversation: (key: string) => void;
  renameConversation: (key: string, label: string) => void;
  removeConversation: (key: string) => Promise<void>;
  reset: () => void;
}

let loadPromise: Promise<ConversationItem[]> | null = null;
let draftPromise: Promise<ConversationItem> | null = null;

const toItem = (conversation: { id: number; title: string }): ConversationItem => ({
  key: String(conversation.id),
  label: conversation.title,
});

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeKey: '',
  initialized: false,
  loadFailed: false,

  loadConversations: async () => {
    if (get().initialized) return get().conversations;
    if (loadPromise) return loadPromise;

    set({ loadFailed: false });
    loadPromise = listConversations()
      .then((list) => list.map(toItem))
      .then((conversations) => {
        set({ conversations, initialized: true });
        return conversations;
      })
      .catch((error) => {
        set({ initialized: false, loadFailed: true });
        throw error;
      })
      .finally(() => {
        loadPromise = null;
      });
    return loadPromise;
  },

  ensureDraft: async () => {
    await get().loadConversations();
    const existing = findDraftConversation(get().conversations);
    if (existing) {
      set((state) => ({
        conversations: [existing, ...state.conversations.filter((item) => item.key !== existing.key)],
        activeKey: existing.key,
      }));
      return existing;
    }
    if (draftPromise) return draftPromise;

    draftPromise = createConversation()
      .then(toItem)
      .then((created) => {
        set((state) => ({
          conversations: [created, ...state.conversations],
          activeKey: created.key,
        }));
        return created;
      })
      .finally(() => {
        draftPromise = null;
      });
    return draftPromise;
  },

  selectConversation: (activeKey) => set({ activeKey }),

  renameConversation: (key, label) => set((state) => ({
    conversations: state.conversations.map((item) => (
      item.key === key ? { ...item, label } : item
    )),
  })),

  removeConversation: async (key) => {
    await deleteConversation(Number(key));
    const state = get();
    const conversations = state.conversations.filter((item) => item.key !== key);
    set({
      conversations,
      activeKey: state.activeKey === key ? conversations[0]?.key ?? '' : state.activeKey,
    });
    if (!conversations.length) await get().ensureDraft();
  },

  reset: () => {
    loadPromise = null;
    draftPromise = null;
    set({ conversations: [], activeKey: '', initialized: false, loadFailed: false });
  },
}));
