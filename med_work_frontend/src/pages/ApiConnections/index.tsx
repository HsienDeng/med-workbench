import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Empty, Flex, Segmented, Tag, Typography } from 'antd';
import {
  CheckCircleFilled,
  CheckOutlined,
  ExclamationCircleFilled,
  KeyOutlined,
  ReloadOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import PageHead from '@/components/PageHead';
import { colors } from '@/theme';
import { API_PROVIDER_TEMPLATES, useApiConnectionStore } from '@/stores/apiConnections';
import { useAppStore } from '@/stores/app';
import type { ApiConnection, ApiConnectionStatus } from '@/types';
import './index.css';

const STATUS_TEXT: Record<ApiConnectionStatus, string> = {
  connected: '当前路由',
  ready: '已配置',
  testing: '校验中',
  error: '配置缺失',
  disabled: '已停用',
};

const FILTERS = [
  { label: '全部', value: 'all' },
  { label: '已配置', value: 'configured' },
  { label: '配置缺失', value: 'incomplete' },
] as const;

type FilterValue = (typeof FILTERS)[number]['value'];

function isConfigured(connection: ApiConnection) {
  return connection.hasApiKey;
}

export default function ApiConnections() {
  const { message } = AntApp.useApp();
  const user = useAppStore((state) => state.user);
  const connections = useApiConnectionStore((state) => state.connections);
  const loading = useApiConnectionStore((state) => state.loading);
  const switchingProvider = useApiConnectionStore((state) => state.switchingProvider);
  const error = useApiConnectionStore((state) => state.error);
  const loadConnections = useApiConnectionStore((state) => state.loadConnections);
  const setActiveProvider = useApiConnectionStore((state) => state.setActiveProvider);
  const [filter, setFilter] = useState<FilterValue>('all');

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const activeRoute = connections.find((item) => item.status === 'connected');
  const visibleConnections = useMemo(() => {
    if (filter === 'configured') return connections.filter(isConfigured);
    if (filter === 'incomplete') return connections.filter((item) => !isConfigured(item));
    return connections;
  }, [connections, filter]);

  const configuredCount = connections.filter(isConfigured).length;
  const canSwitchProvider = user?.roles.some((role) => role.role_code === 'hospital_admin') ?? false;

  const handleSwitchProvider = async (connection: ApiConnection) => {
    try {
      await setActiveProvider(connection.provider);
      message.success(`已将 ${connection.name} 设为当前调用路由`);
    } catch {
      // 全局请求层已展示具体错误，页面保留切换前状态。
    }
  };

  return (
    <div className="workbench-page api-page">
      <PageHead
        crumbs={[]}
        title="API 连接"
        subtitle="查看服务端模型供应商、网关地址、凭据状态与默认调用路由"
        actions={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadConnections()}>
            刷新配置
          </Button>
        }
      />

      <section className="api-hero">
        <div>
          <h2>模型凭据由服务端统一管理</h2>
          <p>
            {configuredCount}/{connections.length} 个已注册通道已配置凭据。
            页面仅展示配置状态，不读取或保存 API Key 明文。
          </p>
          <div className="api-hero-stats">
            <div><strong>{configuredCount}</strong><span>已配置</span></div>
            <div><strong>{connections.length - configuredCount}</strong><span>待配置</span></div>
            <div><strong>{activeRoute?.name || '—'}</strong><span>默认路由</span></div>
          </div>
        </div>
        <div className="api-route-map" aria-label="API 调用链路示意图">
          <div className="api-rail-node">医疗任务</div>
          <span className="api-rail-line" />
          <div className={`api-rail-node route ${activeRoute ? 'online' : ''}`}>
            <small>MED ROUTER</small>{activeRoute?.name || '未设置'}
          </div>
          <span className="api-rail-line dashed" />
          <div className="api-rail-node endpoint">{activeRoute?.provider.toUpperCase() || 'NONE'}</div>
        </div>
      </section>

      <Card
        title={
          <Flex vertical gap={3}>
            <Typography.Text strong style={{ fontSize: 15 }}>
              服务端供应商通道
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              当前展示后端已注册的 AI 供应商配置
            </Typography.Text>
          </Flex>
        }
        extra={
          <Segmented
            value={filter}
            onChange={(value) => setFilter(value as FilterValue)}
            options={FILTERS.map(({ label, value }) => ({ label, value }))}
          />
        }
        styles={{ body: { padding: '16px 20px' } }}
      >
        <div className="api-card-grid">
          {error ? (
            <Empty
              style={{ gridColumn: '1 / -1', padding: '32px 0' }}
              description={error}
            >
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadConnections()}>
                重新加载
              </Button>
            </Empty>
          ) : visibleConnections.length === 0 ? (
            <Empty
              style={{ gridColumn: '1 / -1', padding: '32px 0' }}
              description={loading ? '正在读取服务端配置' : '没有符合筛选条件的连接'}
            />
          ) : (
            visibleConnections.map((connection) => {
              const template = API_PROVIDER_TEMPLATES.find((item) => item.provider === connection.provider);
              const accent = template?.accent || colors.primary;
              return (
                <article key={connection.id} className="api-card">
                  <div className="api-card-accent" style={{ background: accent }} />
                  <header>
                    <div>
                      <h3>{connection.name}</h3>
                      <p>{template?.description || 'OpenAI 兼容模型服务'}</p>
                    </div>
                    <Tag
                      color={
                        connection.status === 'connected'
                          ? 'success'
                          : connection.status === 'ready'
                            ? 'blue'
                            : connection.status === 'testing'
                              ? 'processing'
                              : connection.status === 'error'
                                ? 'error'
                                : 'default'
                      }
                      icon={
                        connection.status === 'connected' ? (
                          <CheckCircleFilled />
                        ) : connection.status === 'error' ? (
                          <ExclamationCircleFilled />
                        ) : undefined
                      }
                      style={{ marginInlineEnd: 0 }}
                    >
                      {STATUS_TEXT[connection.status]}
                    </Tag>
                  </header>
                  <dl>
                    <div><dt>地址</dt><dd>{connection.baseUrl}</dd></div>
                    <div><dt>默认模型</dt><dd>{connection.activeModel}</dd></div>
                    <div><dt>协议</dt><dd>{connection.protocol}</dd></div>
                    <div><dt>凭据</dt><dd>{connection.hasApiKey ? '已在服务端配置' : '未配置'}</dd></div>
                  </dl>
                  <footer>
                    <div className="api-card-tags">
                      <Tag icon={<KeyOutlined />} color={connection.hasApiKey ? 'success' : 'error'}>
                        {connection.hasApiKey ? '凭据可用' : '缺少 API Key'}
                      </Tag>
                      <Tag color={connection.status === 'connected' ? 'processing' : 'default'}>
                        {connection.status === 'connected' ? '参与当前调用' : '未激活'}
                      </Tag>
                    </div>
                    {canSwitchProvider && (
                      <Button
                        type={connection.status === 'connected' ? 'default' : 'primary'}
                        icon={connection.status === 'connected' ? <CheckOutlined /> : <SwapOutlined />}
                        loading={switchingProvider === connection.provider}
                        disabled={
                          connection.status === 'connected'
                          || !connection.hasApiKey
                          || switchingProvider !== null
                        }
                        onClick={() => void handleSwitchProvider(connection)}
                      >
                        {connection.status === 'connected'
                          ? '正在使用'
                          : connection.hasApiKey
                            ? '设为当前路由'
                            : '凭据未配置'}
                      </Button>
                    )}
                  </footer>
                </article>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
