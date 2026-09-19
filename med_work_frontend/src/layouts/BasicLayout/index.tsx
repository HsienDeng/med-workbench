import { useEffect, useState } from "react";
import {
  Layout,
  Menu,
  Input,
  Avatar,
  Button,
  Dropdown,
  Popconfirm,
  App as AntApp,
  type MenuProps,
} from "antd";
import {
  SearchOutlined,
  DownOutlined,
  DeleteOutlined,
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { colors } from "@/theme";
import { useNavGroups } from "@/constants/menu";
import { useAppStore } from "@/stores/app";
import { useConversationStore } from "@/stores/conversations";
import { visibleConversations } from "@/stores/conversationState";
import type { AuthUser, PageKey } from "@/types";
import Logo from "./components/Logo";
import NotificationBell from "./components/NotificationBell";
import "./index.css";

const { Sider, Header, Content } = Layout;

type SidebarMenuItem = NonNullable<MenuProps["items"]>[number];

export interface BasicLayoutProps {
  page: PageKey;
  onNavigate: (key: PageKey) => void;
  onNewConversation: () => void;
  onOpenConversation: (key: string) => void;
  user: AuthUser;
  onLogout: () => void;
  children: React.ReactNode;
}

export default function BasicLayout({
  page,
  onNavigate,
  onNewConversation,
  onOpenConversation,
  user,
  onLogout,
  children,
}: BasicLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { message } = AntApp.useApp();
  const dynamicMenus = useAppStore((state) => state.menus);
  const menusLoaded = useAppStore((state) => state.menusLoaded);
  const navGroups = useNavGroups(dynamicMenus, !menusLoaded);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [deletingConversationKey, setDeletingConversationKey] = useState('');
  const conversations = useConversationStore((state) => state.conversations);
  const activeConversationKey = useConversationStore((state) => state.activeKey);
  const conversationsInitialized = useConversationStore((state) => state.initialized);
  const conversationsLoadFailed = useConversationStore((state) => state.loadFailed);
  const loadConversations = useConversationStore((state) => state.loadConversations);
  const selectConversation = useConversationStore((state) => state.selectConversation);
  const removeConversation = useConversationStore((state) => state.removeConversation);

  useEffect(() => {
    void loadConversations().catch(() => message.error('对话历史加载失败'));
  }, [loadConversations, message]);

  const handleOpenConversation = (key: string) => {
    selectConversation(key);
    onOpenConversation(key);
  };

  const handleDeleteConversation = async (key: string) => {
    if (deletingConversationKey) return;
    setDeletingConversationKey(key);
    try {
      await removeConversation(key);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除对话失败');
    } finally {
      setDeletingConversationKey('');
    }
  };

  const handleSidebarCollapse = (nextCollapsed: boolean) => {
    setCollapsed(nextCollapsed);
    if (nextCollapsed) setOpenGroups([]);
  };

  const menuItems = navGroups.flatMap<SidebarMenuItem>((group) => {
    const children: SidebarMenuItem[] = group.items.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {item.label}
          {item.phase2 ? (
            <span
              style={{
                fontSize: 10,
                color: colors.textMuted,
                background: colors.bgSecondary,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                padding: "0 4px",
                lineHeight: "16px",
              }}
            >
              二期
            </span>
          ) : item.badge ? (
            <span
              style={{
                fontSize: 10,
                color: colors.aiDark,
                background: colors.aiLight,
                borderRadius: 4,
                padding: "0 4px",
                lineHeight: "16px",
                fontWeight: 700,
              }}
            >
              {item.badge}
            </span>
          ) : null}
        </span>
      ),
      onClick: () => item.key === 'newConversation' ? onNewConversation() : onNavigate(item.key),
    }));

    // title 为空：无分组标题，items 直接平铺为顶级菜单项
    if (!group.title) return children;

    return group.collapsible
      ? { key: group.title, label: group.title, type: "submenu" as const, children }
      : { key: group.title, label: group.title, type: "group" as const, children };
  });
  const systemMenuIndex = menuItems.findIndex(
    (item) => item && "key" in item && item.key === "系统设置",
  );
  const primaryMenuItems = systemMenuIndex < 0 ? menuItems : menuItems.slice(0, systemMenuIndex);
  const systemMenuItems = systemMenuIndex < 0 ? [] : menuItems.slice(systemMenuIndex);
  const selectedKeys = [page === "assistant" ? "newConversation" : page];
  const recentConversationItems: MenuProps["items"] = [
    {
      key: "recentConversations",
      label: "最近对话",
      children: conversations.length
        ? visibleConversations(conversations).map((conversation) => ({
            key: conversation.key,
            label: conversation.label,
            title: conversation.label,
            extra: (
              <Popconfirm
                title="删除这段对话？"
                description="删除后无法恢复"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: deletingConversationKey === conversation.key }}
                onConfirm={() => handleDeleteConversation(conversation.key)}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={Boolean(deletingConversationKey)}
                  title="删除对话"
                  aria-label={`删除对话：${conversation.label}`}
                  onClick={(event) => event.stopPropagation()}
                />
              </Popconfirm>
            ),
          }))
        : [{
            key: "recentConversationsEmpty",
            label: conversationsLoadFailed
              ? "加载失败，请刷新重试"
              : conversationsInitialized ? "暂无历史会话" : "正在加载会话…",
            disabled: true,
          }],
    },
  ];

  const userMenu = {
    items: [
      { key: "profile", icon: <UserOutlined />, label: "个人中心" },
      { key: "pref", icon: <SettingOutlined />, label: "偏好设置" },
      { type: "divider" as const },
      {
        key: "logout",
        icon: <LogoutOutlined />,
        label: "退出登录",
        onClick: () => {
          message.success("已退出登录");
          onLogout();
        },
      },
    ],
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={232}
        collapsible
        collapsed={collapsed}
        collapsedWidth={0}
        breakpoint="md"
        onCollapse={handleSidebarCollapse}
        onBreakpoint={setCollapsed}
        theme="light"
        className="app-sidebar"
        style={{
          borderRight: `1px solid ${colors.border}`,
          position: "sticky",
          top: 0,
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <Logo collapsed={collapsed} />
          <div
            className="app-sidebar-menu-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
          >
            <Menu
              mode="inline"
              items={primaryMenuItems}
              selectedKeys={selectedKeys}
              openKeys={openGroups}
              onOpenChange={(keys) => setOpenGroups(keys as string[])}
              className="app-sidebar-menu"
              style={{ borderInlineEnd: "none", paddingTop: 8 }}
            />
            <Menu
              mode="inline"
              items={recentConversationItems}
              selectedKeys={[activeConversationKey]}
              defaultOpenKeys={["recentConversations"]}
              onClick={({ key }) => handleOpenConversation(key)}
              className="app-sidebar-menu"
              style={{ borderInlineEnd: "none" }}
            />
            {systemMenuItems.length ? (
              <Menu
                mode="inline"
                items={systemMenuItems}
                selectedKeys={selectedKeys}
                openKeys={openGroups}
                onOpenChange={(keys) => setOpenGroups(keys as string[])}
                className="app-sidebar-menu"
                style={{ borderInlineEnd: "none" }}
              />
            ) : null}
          </div>
        </div>
      </Sider>
      <Layout>
        <Header
          className="app-header"
          style={{
            height: 56,
            lineHeight: "56px",
            padding: "0 24px",
            background: "#fff",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div
            className="app-header-search"
            style={{ display: "flex", alignItems: "center", gap: 16, flex: 1 }}
          >
            <Input
              prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
              placeholder="搜索患者、任务、文档..."
              allowClear
              style={{
                maxWidth: 320,
                borderRadius: 8,
                background: colors.bgSecondary,
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <NotificationBell />
            <Dropdown menu={userMenu} placement="bottomRight">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 8px",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                <Avatar
                  size={30}
                  style={{
                    background: `linear-gradient(135deg, ${colors.primary}, ${colors.purple})`,
                  }}
                >
                  {user.real_name[0]}
                </Avatar>
                <div className="app-header-user-meta" style={{ lineHeight: 1.2 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: colors.text,
                    }}
                  >
                    {user.real_name}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {user.roles[0]?.role_name ?? user.username}
                  </div>
                </div>
                <DownOutlined
                  className="app-header-user-arrow"
                  style={{ fontSize: 10, color: colors.textMuted }}
                />
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content>{children}</Content>
      </Layout>
    </Layout>
  );
}
