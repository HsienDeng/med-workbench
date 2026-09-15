import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Empty, List, Popover, Tag, Tooltip, Typography } from 'antd';
import { BellOutlined, CloseCircleOutlined, RobotOutlined } from '@ant-design/icons';
import { colors } from '@/theme';
import type { NotificationItem } from '@/types';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/notifications';

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(5, 16) : '';
}

function typeMeta(type: string): { color: string; label: string } {
  switch (type) {
    case 'analysis_failed':
      return { color: 'error', label: '分析失败' };
    default:
      return { color: 'blue', label: '系统通知' };
  }
}

/**
 * 顶部通知铃铛：展示当前用户未读角标与最近通知，
 * 支持单条已读、全部已读；进入布局时拉取一次并按 60s 轮询。
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // 取最新 8 条，接口同时返回未读数
      const res = await getNotifications(1, 8);
      setItems(res.items);
      setUnread(res.unread);
    } catch {
      // 全局错误提示已由 api.ts 处理，静默失败不打扰
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const handleRead = async (item: NotificationItem) => {
    if (item.is_read) return;
    try {
      await markNotificationRead(item.id);
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, is_read: true } : it)));
      setUnread((prev) => Math.max(0, prev - 1));
    } catch {
      // 失败静默，保留未读
    }
  };

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((it) => ({ ...it, is_read: true })));
      setUnread(0);
    } catch {
      // 失败静默
    }
  };

  const content = (
    <div style={{ width: 340 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px 4px',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>消息通知</span>
        {unread > 0 && (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void handleReadAll()}>
            全部已读
          </Button>
        )}
      </div>
      <List
        loading={loading}
        dataSource={items}
        style={{ maxHeight: 420, overflow: 'auto' }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" /> }}
        renderItem={(item) => {
          const meta = typeMeta(item.type);
          return (
            <List.Item
              key={item.id}
              style={{
                cursor: 'pointer',
                padding: '10px 12px',
                background: item.is_read ? undefined : '#f0f5ff',
              }}
              onClick={() => void handleRead(item)}
            >
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {item.type === 'analysis_failed' ? (
                    <CloseCircleOutlined style={{ color: colors.error }} />
                  ) : (
                    <RobotOutlined style={{ color: colors.ai }} />
                  )}
                  <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                    {meta.label}
                  </Tag>
                  {!item.is_read && <Badge status="processing" />}
                </div>
                <Typography.Text strong style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                  {item.title}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  ellipsis
                  style={{ fontSize: 12, display: 'block', marginTop: 2 }}
                >
                  {item.content || '—'}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {formatTime(item.created_at)}
                </Typography.Text>
              </div>
            </List.Item>
          );
        }}
      />
      {items.some((it) => it.resource_type === 'analysis_record') && (
        <div
          className="text-muted"
          style={{ padding: '6px 12px', fontSize: 11, borderTop: '1px solid #f0f0f0' }}
        >
          失败任务可在「我的分析」中对失败记录点击「重试」。
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      arrow={false}
    >
      <Tooltip title={unread ? `您有 ${unread} 条未读通知` : '消息通知'}>
        <Badge count={unread} size="small" offset={[-2, 2]}>
          <div
            className="app-header-user"
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: colors.textSecondary,
            }}
          >
            <BellOutlined style={{ fontSize: 16 }} />
          </div>
        </Badge>
      </Tooltip>
    </Popover>
  );
}
