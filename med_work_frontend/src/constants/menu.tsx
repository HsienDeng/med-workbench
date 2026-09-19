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
};

export const PAGE_KEYS = [
  'dashboard', 'analysis', 'patients', 'documents', 'wxGroups',
  'assistant', 'entities', 'retrieval', 'dictionaries', 'accounts', 'permissions',
  'audit',
] satisfies readonly PageKey[];

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

/** 将后端扁平菜单组装为侧边栏分组；后端数据按父节点在前返回。 */
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
      if (!isPageKey(key)) continue;
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
    return result;
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
      { key: 'entities', icon: <ApartmentOutlined />, label: '医疗实体', phase2: true },
      { key: 'retrieval', icon: <ExperimentOutlined />, label: '检索测试' },
    ],
  },
  {
    title: '系统设置',
    collapsible: true,
    items: [
      { key: 'dictionaries', icon: <BookOutlined />, label: '字典管理' },
      { key: 'accounts', icon: <UserOutlined />, label: '账号管理' },
      { key: 'permissions', icon: <SafetyCertificateOutlined />, label: '权限管理' },
      { key: 'audit', icon: <FileProtectOutlined />, label: '审计日志' },
    ],
  },
];
