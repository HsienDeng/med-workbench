/**
 * 侧边栏导航菜单配置
 */
import {
  DashboardOutlined,
  FileSearchOutlined,
  TeamOutlined,
  BookOutlined,
  FolderOpenOutlined,
  ApartmentOutlined,
  ExperimentOutlined,
  GitlabOutlined,
  ApiOutlined,
  MessageOutlined,
  ToolOutlined,
  DatabaseOutlined,
  BarChartOutlined,
  FundOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  FileProtectOutlined,
  SettingOutlined,
  RobotOutlined,
  AppstoreOutlined,
  WechatOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMemo } from 'react';
import type { DynamicMenu, PageKey } from '@/types';

export interface NavItem {
  key: PageKey | 'newConversation';
  icon?: React.ReactNode;
  label: string;
  phase2?: boolean;
  badge?: string;
}

/**
 * 侧边栏分组。
 * title 为空字符串时表示该组无分组标题，其 items 会平铺为顶级菜单项。
 */
export interface NavGroup {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
}

const ICONS: Record<string, React.ComponentType> = {
  AppstoreOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  TeamOutlined,
  BookOutlined,
  FolderOpenOutlined,
  ApartmentOutlined,
  ExperimentOutlined,
  GitlabOutlined,
  ApiOutlined,
  MessageOutlined,
  ToolOutlined,
  DatabaseOutlined,
  BarChartOutlined,
  FundOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  FileProtectOutlined,
  SettingOutlined,
  RobotOutlined,
  WechatOutlined,
  PlusOutlined,
  ThunderboltOutlined,
};

export const PAGE_KEYS = [
  'dashboard', 'analysis', 'patients', 'documents', 'wxGroups',
  'assistant', 'entities', 'retrieval', 'dictionaries', 'accounts', 'permissions',
  'audit', 'ai-connections', 'prompts',
] satisfies readonly PageKey[];

/**
 * 侧边栏需要隐藏的页面（页面可手动通过 URL 访问，仅菜单不展示）。
 * 后端菜单仍返回「系统设置」父节点及其子项，这里统一过滤，
 * 保证侧边栏只保留业务菜单；管理入口改由 Header 齿轮（SYSTEM_ENTRIES）提供。
 */
export const HIDDEN_PAGE_KEYS: ReadonlySet<PageKey> = new Set<PageKey>([
  'dashboard',
  'entities',
  'retrieval',
  'dictionaries',
  'accounts',
  'permissions',
  'audit',
  // AI 服务管理：侧边栏导航不渲染，由 BasicLayout 底部固定入口（pinned）展示
  'ai-connections',
]);

export function isPageKey(key: string): key is PageKey {
  return (PAGE_KEYS as readonly string[]).includes(key);
}

export function getPagePath(page: PageKey): string {
  return `/${page}`;
}

export function getPageFromPath(pathname: string): PageKey | null {
  const key = pathname.replace(/^\/+|\/+$/g, '');
  return isPageKey(key) ? key : null;
}

/**
 * 将后端扁平菜单组装为侧边栏分组；后端数据按父节点在前返回。
 * `HIDDEN_PAGE_KEYS` 里的路由不会出现在侧边栏（页面可手动通过 URL 访问，仅菜单隐藏）。
 */
export function useNavGroups(menus: DynamicMenu[], useFallback: boolean): NavGroup[] {
  return useMemo(() => {
    if (!menus.length) return useFallback ? NAV_GROUPS : [];

    const result: NavGroup[] = [];
    // 无 parentKey 的页面项归入「无标题分组」，渲染时平铺为顶级菜单项
    let flatGroup: NavGroup | null = null;
    let currentGroup: NavGroup | null = null;
    for (const item of menus) {
      if (!item.routeKey) {
        currentGroup = {
          title: item.key === 'clinical-hub' ? '' : item.title,
          items: [],
          collapsible: Boolean(item.collapsible),
        };
        result.push(currentGroup);
        continue;
      }
      const key = item.routeKey;
      if (!isPageKey(key) || HIDDEN_PAGE_KEYS.has(key)) continue;
      const IconComponent = item.icon ? ICONS[item.icon] : undefined;
      const navItem: NavItem = {
        key: item.key === 'new-conversation' ? 'newConversation' : key,
        icon: IconComponent ? <IconComponent /> : undefined,
        label: item.title,
        phase2: item.phase2,
        badge: item.badge ?? undefined,
      };
      if (!item.parentKey) {
        if (!flatGroup) {
          flatGroup = { title: '', items: [] };
          result.push(flatGroup);
        }
        flatGroup.items.push(navItem);
        continue;
      }
      currentGroup?.items.push(navItem);
    }
    // 子项全部被隐藏的分组（如「系统设置」）不再渲染，避免只剩一个空的分组标题
    return result.filter((group) => group.items.length > 0);
  }, [menus, useFallback]);
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: '',
    items: [{ key: 'newConversation', icon: <PlusOutlined />, label: '新会话' }],
  },
  {
    title: '',
    items: [
      { key: 'dashboard', icon: <DashboardOutlined />, label: '工作台总览' },
      { key: 'analysis', icon: <FileSearchOutlined />, label: 'AI 病历分析', badge: 'Beta' },
      { key: 'patients', icon: <TeamOutlined />, label: '患者档案' },
      { key: 'documents', icon: <FolderOpenOutlined />, label: '文档管理' },
    ],
  },
];

/**
 * 侧边栏之外的"系统设置"入口（Header 右上角齿轮 Dropdown）。
 * 项顺序即下拉展示顺序；用户无对应权限时自动隐藏。
 */
export interface SystemEntry {
  key: PageKey;
  icon: React.ReactNode;
  label: string;
  permission: string;
}

export const SYSTEM_ENTRIES: SystemEntry[] = [
  { key: 'dictionaries', icon: <BookOutlined />, label: '字典管理', permission: 'dictionary:view' },
  { key: 'accounts', icon: <UserOutlined />, label: '账号管理', permission: 'organization:user:view' },
  { key: 'permissions', icon: <SafetyCertificateOutlined />, label: '权限管理', permission: 'organization:role:view' },
  { key: 'audit', icon: <FileProtectOutlined />, label: '审计日志', permission: 'audit:view' },
];
