import { create } from 'zustand';
import { clearAuth, loadAuth, saveAuth } from '@/services/auth-storage';
import type { AuthUser, DynamicMenu } from '@/types';

interface AppState {
  user: AuthUser | null;
  token: string | null;
  menus: DynamicMenu[];
  menusLoaded: boolean;
  setMenus: (menus: DynamicMenu[]) => void;
  login: (auth: { token: string; user: AuthUser; remember?: boolean }) => void;
  logout: () => void;
}

const init = loadAuth();

export const useAppStore = create<AppState>((set) => ({
  user: init?.user ?? null,
  token: init?.token ?? null,
  menus: [],
  menusLoaded: false,
  setMenus: (menus) => set({ menus, menusLoaded: true }),
  login: ({ token, user, remember }) => {
    saveAuth({ token, user }, Boolean(remember));
    set({ user, token, menus: [], menusLoaded: false });
  },
  logout: () => {
    clearAuth();
    set({ user: null, token: null, menus: [], menusLoaded: false });
  },
}));
