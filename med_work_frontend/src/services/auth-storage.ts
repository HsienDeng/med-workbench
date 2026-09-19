import type { AuthUser } from '@/types';

export interface StoredAuth {
  token: string;
  user: AuthUser;
  /** 本地估算的过期时间戳（毫秒）；令牌真实失效以后端返回 401 为准 */
  expiresAt?: number;
}

export interface RememberedCredentials {
  account: string;
  password: string;
}

const AUTH_KEY = 'medai_auth';
/**
 * "记住我" 落地：保存账号 + 密码，仅当用户明确勾选并登录成功时写入；
 * 取消勾选再登录成功会被清空。值是 JSON 字符串，
 * 旧版本可能只存了纯字符串（只有账号），读取时做了兼容。
 */
const REMEMBERED_CREDENTIALS_KEY = 'medai_remembered_credentials';

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

function readRemembered(): RememberedCredentials | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
    if (!raw) return null;
    // 兼容旧版本（只存了 username 字符串）
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Partial<RememberedCredentials> | null;
      if (parsed && typeof parsed.account === 'string' && parsed.account) {
        return {
          account: parsed.account,
          password: typeof parsed.password === 'string' ? parsed.password : '',
        };
      }
      return null;
    }
    return raw ? { account: raw, password: '' } : null;
  } catch {
    return null;
  }
}

function writeRemembered(credentials: RememberedCredentials | null) {
  if (!credentials || !credentials.account) {
    localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
    return;
  }
  localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify(credentials));
}

/**
 * 保存登录态。
 * - remember=true：写入 localStorage（关闭浏览器仍保持登录，最长 7 天）；
 * - remember=false：仅写入 sessionStorage（关闭浏览器/标签即失效）。
 *
 * 「记住我」对应的账号密码保存请用 saveRememberedCredentials / clearRememberedCredentials，
 * 放在登录页直接调用，避免凭据穿过多层链路。
 */
export function saveAuth(auth: StoredAuth, remember = false) {
  const ttlHours = remember ? REMEMBER_HOURS : SESSION_HOURS;
  // 两种存储互斥，避免上一次的登录态残留导致"记住我"失效判断不准
  if (remember) sessionStorage.removeItem(AUTH_KEY);
  else localStorage.removeItem(AUTH_KEY);
  write(remember ? localStorage : sessionStorage, auth, ttlHours);
}

/** 写入"记住我"的账号密码到 localStorage（登录页在勾选记住我并登录成功后调用） */
export function saveRememberedCredentials(credentials: {
  account: string;
  password: string;
}) {
  if (!credentials || !credentials.account) {
    localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
    if (import.meta.env.DEV) {
      console.warn('[remember] empty credentials, removed cached entry');
    }
    return;
  }
  localStorage.setItem(
    REMEMBERED_CREDENTIALS_KEY,
    JSON.stringify({ account: credentials.account, password: credentials.password ?? '' }),
  );
  if (import.meta.env.DEV) {
    console.log('[remember] saved', {
      account: credentials.account,
      passwordLen: (credentials.password ?? '').length,
    });
  }
}

/** 读取登录态：先本地（记住我），再会话级 */
export function loadAuth(): StoredAuth | null {
  return read(localStorage) ?? read(sessionStorage);
}

/** 清除登录态；记住的账号密码保留，便于下次登录无需重复输入 */
export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
}

/** 上次勾选"记住我"登录成功的账号（仅用于显示，登录表单填充请用 loadRememberedCredentials） */
export function loadRememberedAccount(): string {
  return readRemembered()?.account ?? '';
}

/** 上次勾选"记住我"登录成功的账号 + 密码；登录页用它自动填充表单 */
export function loadRememberedCredentials(): RememberedCredentials | null {
  return readRemembered();
}

/** 主动清除记住的账号密码（一般由登录页在「未勾选记住我」登录成功后调用） */
export function clearRememberedCredentials() {
  writeRemembered(null);
}