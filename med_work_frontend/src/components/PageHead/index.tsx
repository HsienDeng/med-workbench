import type { ReactNode } from 'react';
import { Breadcrumb, Flex, Typography } from 'antd';

export interface Crumb {
  label: string;
  current?: boolean;
}

export interface PageHeadProps {
  crumbs: Crumb[];
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** 紧凑模式：缩小标题字号与间距，适用于满高工作台页面 */
  dense?: boolean;
}

export default function PageHead({ crumbs, title, subtitle, actions, dense }: PageHeadProps) {
  const items = crumbs.map((c) => ({ title: c.label }));
  return (
    <Flex align="flex-start" justify="space-between" gap={16} wrap>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Breadcrumb items={items} />
        <Typography.Title level={dense ? 5 : 4} style={{ margin: dense ? '2px 0 0' : '6px 0 0' }}>
          {title}
        </Typography.Title>
        {subtitle && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
            {subtitle}
          </Typography.Text>
        )}
      </div>
      {actions && (
        <Flex align="center" gap={10}>
          {actions}
        </Flex>
      )}
    </Flex>
  );
}
