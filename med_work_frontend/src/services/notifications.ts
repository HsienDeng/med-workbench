/**
 * 站内通知接口封装（/api/notifications）。
 *
 * 铃铛入口使用：拉取未读数与最近通知，支持单条 / 全部已读。
 */
import { request } from './api';
import type { NotificationListResponse } from '@/types';

/** 分页查询当前用户通知（响应含未读数），pageSize 建议传入 8~20 */
export function getNotifications(
  page = 1,
  pageSize = 8,
  unreadOnly = false,
): Promise<NotificationListResponse> {
  const search = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    unread_only: unreadOnly ? 'true' : 'false',
  });
  return request<NotificationListResponse>(`/api/notifications?${search.toString()}`);
}

/** 标记单条通知已读 */
export function markNotificationRead(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'PATCH' });
}

/** 全部标记已读 */
export function markAllNotificationsRead(): Promise<{ ok: boolean; updated: number }> {
  return request<{ ok: boolean; updated: number }>('/api/notifications/read-all', {
    method: 'POST',
  });
}
