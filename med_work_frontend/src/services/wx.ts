/**
 * 企业微信外部群管理服务
 *
 * 后端代理企微「客户联系」接口：群同步、患者绑定、企业群发。
 * 注意：群发提交成功 ≠ 已发送，需群主在企业微信客户端确认后才会真正发出。
 */
import { loadAuth } from './auth-storage';
import type {
  WecomApiContactsBatch,
  WecomApiDevice,
  WecomApiLoginStatus,
  WecomApiProfile,
  WecomApiRoomMembers,
  WecomApiRoomMessages,
  WecomApiRooms,
  WecomApiStatus,
  WxGroupCreatePayload,
  WxGroupDetail,
  WxGroupItem,
  WxGroupUpdatePayload,
  WxMessageCreatePayload,
  WxMessageItem,
  WxStatus,
  WxSyncResult,
} from '@/types';

/** 带鉴权的 JSON 请求封装 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = loadAuth()?.token;
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const payload = (await res.json()) as { message?: string; detail?: string };
      message = payload.message || payload.detail || message;
    } catch {
      /* 响应体非 JSON，沿用默认文案 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface WxGroupListResult {
  items: WxGroupItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface WxMessageListResult {
  items: WxMessageItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 企业微信集成状态 */
export const getWxStatus = () => request<WxStatus>('/api/wx/status');

/** 群列表（分页 + 筛选） */
export const listWxGroups = (params: {
  keyword?: string;
  bound?: boolean;
  status?: number;
  page?: number;
  page_size?: number;
}) => {
  const query = new URLSearchParams();
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.bound !== undefined) query.set('bound', String(params.bound));
  if (params.status !== undefined) query.set('status', String(params.status));
  if (params.page) query.set('page', String(params.page));
  if (params.page_size) query.set('page_size', String(params.page_size));
  const qs = query.toString();
  return request<WxGroupListResult>(`/api/wx/groups${qs ? `?${qs}` : ''}`);
};

/** 手动触发群同步（同步进行中后端返回 409） */
export const syncWxGroups = () =>
  request<WxSyncResult>('/api/wx/groups/sync', { method: 'POST' });

/** 手动添加群（无企微凭证时维护群列表的入口） */
export const createWxGroup = (payload: WxGroupCreatePayload) =>
  request<WxGroupItem>('/api/wx/groups', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** 更新群信息（群名 / 群主 / 成员数 / Webhook 地址） */
export const updateWxGroup = (groupId: number, payload: WxGroupUpdatePayload) =>
  request<WxGroupDetail>(`/api/wx/groups/${groupId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

/** 群详情 */
export const getWxGroup = (groupId: number) =>
  request<WxGroupDetail>(`/api/wx/groups/${groupId}`);

/** 绑定 / 换绑患者 */
export const bindWxGroupPatient = (groupId: number, patientId: string, patientName: string) =>
  request<WxGroupItem>(`/api/wx/groups/${groupId}/patient`, {
    method: 'PUT',
    body: JSON.stringify({ patient_id: patientId, patient_name: patientName }),
  });

/** 解绑患者 */
export const unbindWxGroupPatient = (groupId: number) =>
  request<{ ok: boolean }>(`/api/wx/groups/${groupId}/patient`, { method: 'DELETE' });

/** 推送记录列表 */
export const listWxMessages = (params: {
  group_id?: number;
  status?: string;
  page?: number;
  page_size?: number;
}) => {
  const query = new URLSearchParams();
  if (params.group_id !== undefined) query.set('group_id', String(params.group_id));
  if (params.status) query.set('status', params.status);
  if (params.page) query.set('page', String(params.page));
  if (params.page_size) query.set('page_size', String(params.page_size));
  const qs = query.toString();
  return request<WxMessageListResult>(`/api/wx/messages${qs ? `?${qs}` : ''}`);
};

/** 发起群发 */
export const sendWxMessage = (payload: WxMessageCreatePayload) =>
  request<WxMessageItem>('/api/wx/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** 刷新单条推送的发送结果 */
export const refreshWxMessage = (messageId: number) =>
  request<WxMessageItem>(`/api/wx/messages/${messageId}/refresh`, { method: 'POST' });

// ==================== wecomapi 第三方通道（试点） ====================

/** wecomapi 通道状态（不含凭证） */
export const getWecomApiStatus = () => request<WecomApiStatus>('/api/wx/wecomapi/status');

/** 创建设备并获取登录二维码 */
export const createWecomApiDevice = () =>
  request<WecomApiDevice>('/api/wx/wecomapi/device/qrcode', { method: 'POST' });

/** 轮询扫码登录状态 */
export const checkWecomApiLogin = (guid: string) =>
  request<WecomApiLoginStatus>('/api/wx/wecomapi/login/status', {
    method: 'POST',
    body: JSON.stringify({ guid }),
  });

/** 拉取 wecomapi 平台群列表（用于把 roomId 导入到本地群配置） */
export const listWecomApiRooms = (nextStartIndex = 0) => {
  const query = nextStartIndex > 0 ? `?next_start_index=${nextStartIndex}` : '';
  return request<WecomApiRooms>(`/api/wx/wecomapi/rooms${query}`);
};

/** 把选中的 wecomapi 平台群导入到本地群列表（sync_all 为 true 时全量同步） */
export const importWecomApiGroups = (payload: {
  room_ids: string[];
  sync_all?: boolean;
}) =>
  request<WxSyncResult>('/api/wx/wecomapi/groups/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** 拉取 wecomapi 平台指定群的聊天记录 */
export const fetchWecomApiRoomMessages = (roomId: string, limit = 100) =>
  request<WecomApiRoomMessages>(
    `/api/wx/wecomapi/rooms/${encodeURIComponent(roomId)}/messages?limit=${limit}`,
  );

/** 查询当前登录 wecomapi 账号资料（头像、昵称） */
export const getWecomApiProfile = () => request<WecomApiProfile>('/api/wx/wecomapi/profile');

/** 批量获取 wecomapi 联系人详情（用于消息头像） */
export const fetchWecomApiContacts = (userIds: string[]) =>
  request<WecomApiContactsBatch>(
    `/api/wx/wecomapi/contacts?user_ids=${encodeURIComponent(userIds.join(','))}`,
  );

/** 获取 wecomapi 平台指定群的成员列表 */
export const fetchWecomApiRoomMembers = (roomId: string) =>
  request<WecomApiRoomMembers>(
    `/api/wx/wecomapi/rooms/${encodeURIComponent(roomId)}/members`,
  );
