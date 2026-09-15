import { Card, Flex, Statistic, Typography } from 'antd';
import {
  ThunderboltOutlined,
  FileTextOutlined,
  TeamOutlined,
  AuditOutlined,
  SyncOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

const ICON_MAP: Record<string, React.ReactNode> = {
  analysis: <ThunderboltOutlined />,
  docs: <FileTextOutlined />,
  patients: <TeamOutlined />,
  review: <AuditOutlined />,
  update: <SyncOutlined />,
  valid: <CheckCircleOutlined />,
};

const COLOR_MAP: Record<string, string> = {
  blue: '#4f7cff',
  teal: '#13c2c2',
  purple: '#722ed1',
  green: '#52c41a',
  orange: '#fa8c16',
};

export interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  trend?: string;
  trendDir?: string;
  desc?: string;
  icon?: string;
  iconColor?: string;
}

export default function KpiCard({
  label,
  value,
  unit,
  trend,
  trendDir,
  desc,
  icon,
  iconColor = 'blue',
}: KpiCardProps) {
  const color = COLOR_MAP[iconColor] ?? COLOR_MAP.blue;
  return (
    <Card
      size="small"
      styles={{ body: { padding: '18px 20px' } }}
      style={{ height: '100%', boxShadow: '0 1px 2px rgba(27, 37, 55, 0.04)' }}
    >
      <Flex vertical gap={10}>
        <Flex justify="space-between" align="center">
          <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>
            {label}
          </Typography.Text>
          {icon && (
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: color,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {ICON_MAP[icon] ?? <FileTextOutlined />}
            </span>
          )}
        </Flex>
        <Statistic
          value={value}
          suffix={unit}
          valueStyle={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}
        />
        {(trend || desc) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            {trend && (
              <Typography.Text
                type={trendDir === 'up' ? 'success' : 'danger'}
                style={{ fontWeight: 700 }}
              >
                {trend}
              </Typography.Text>
            )}
            {desc && <Typography.Text type="secondary">{desc}</Typography.Text>}
          </div>
        )}
      </Flex>
    </Card>
  );
}
