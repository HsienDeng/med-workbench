/**
 * 认证服务（对接后端 FastAPI + MySQL）
 * 后端地址：http://localhost:8001
 */
import {
  request,
} from "./api";
import {
  clearAuth,
  clearRememberedCredentials,
  loadAuth,
  loadRememberedAccount,
  loadRememberedCredentials,
  saveAuth,
  saveRememberedCredentials,
  type RememberedCredentials,
  type StoredAuth,
} from "./auth-storage";
export {
  clearAuth,
  clearRememberedCredentials,
  loadAuth,
  loadRememberedAccount,
  loadRememberedCredentials,
  saveAuth,
  saveRememberedCredentials,
};
export type { RememberedCredentials, StoredAuth };
import type { AuthResponse, LoginPayload, RegisterPayload } from "@/types";

/** 演示账号（与后端种子数据一致） */
export const DEMO_ACCOUNT = { account: "admin", password: "Admin@123" };

/** 登录 */
export async function loginApi(payload: LoginPayload): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: payload,
    authenticated: false,
  });
}

/** 注册 */
export async function registerApi(
  payload: RegisterPayload,
): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: payload,
    authenticated: false,
  });
}
