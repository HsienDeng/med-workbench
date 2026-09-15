import type { AuthUser } from '@/types';

export interface StoredAuth {
  token: string;
  user: AuthUser;
  /** 本地估算的过期时间戳（毫秒）；令牌真实失效以后端返回 401 为准 */
  expiresAt?: number;
}

const AUTH_KEY = 'medai_auth';
const REMEMBERED_ACCOUNT_KEY = 'medai_last_account';

/** 常规登录的前端保留时长（小时），与后端 session_ttl_hours 对齐 */
export const SESSION_HOURS = 12;
/** 勾选"记住我"后的前端保留时长（小时，7 天） */
export const REMEMBER_HOURS = 24 * 7;

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler;
}

export function triggerUnauthorized() {
  unauthorizedHandler?.();
}

function write(storage: Storage, auth: StoredAuth, ttlHours: number) {
  storage.setItem(
    AUTH_KEY,
    JSON.stringify({ ...auth, expiresAt: Date.now() + ttlHours * 60 * 60 * 1000 }),
  );
}

function read(storage: Storage): StoredAuth | null {
  try {
    const raw = storage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed?.token || !parsed?.user) return null;
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
      storage.removeItem(AUTH_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 保存登录态。
 * - remember=true：写入 localStorage（关闭浏览器仍保持登录，最长 7 天），并记住账号；
 * - remember=false：仅写入 sessionStorage（关闭浏览器/标签即失效）。
 */
export function saveAuth(auth: StoredAuth, remember = false) {
  const ttlHours = remember ? REMEMBER_HOURS : SESSION_HOURS;
  // 两种存储互斥，避免上一次的登录态残留导致"记住我"失效判断不准
  if (remember) sessionStorage.removeItem(AUTH_KEY);
  else localStorage.removeItem(AUTH_KEY);
  write(remember ? localStorage : sessionStorage, auth, ttlHours);
  if (remember) localStorage.setItem(REMEMBERED_ACCOUNT_KEY, auth.user.username);
}

/** 读取登录态：先本地（记住我），再会话级 */
export function loadAuth(): StoredAuth | null {
  return read(localStorage) ?? read(sessionStorage);
}

/** 清除登录态；记住的账号保留，便于下次登录无需重复输入 */
export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
}

/** 上次勾选"记住我"登录成功的账号 */
export function loadRememberedAccount(): string {
  return localStorage.getItem(REMEMBERED_ACCOUNT_KEY) ?? '';
}
