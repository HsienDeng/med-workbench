import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Alert, Button, Empty, Popconfirm, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleFilled,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import PageHead from '@/components/PageHead';
import { useAppStore } from '@/stores/app';
import { useAiProviderStore } from '@/stores/aiProviders';
import { usePermission } from '@/utils/access';
import type { AiProviderItem } from '@/types';
import ProviderFormModal from './ProviderFormModal';
import './index.css';

const PROTOCOL_META: Record<string, { label: string; accent: string }> = {
  openai: { label: 'OpenAI 兼容', accent: '#F59E0B' },
  anthropic: { label: 'Anthropic', accent: '#8B5CF6' },
};

function formatLatency(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`;
}

export default function AiProviderManagement() {
  const { message } = AntApp.useApp();
  const user = useAppStore((state) => state.user);
  const providers = useAiProviderStore((state) => state.providers);
  const loading = useAiProviderStore((state) => state.loading);
  const error = useAiProviderStore((state) => state.error);
  const mutating = useAiProviderStore((state) => state.mutating);
  const probing = useAiProviderStore((state) => state.probing);
  const probes = useAiProviderStore((state) => state.probes);
  const loadProviders = useAiProviderStore((state) => state.loadProviders);
  const activateProvider = useAiProviderStore((state) => state.activateProvider);
  const removeProvider = useAiProviderStore((state) => state.removeProvider);
  const probeProvider = useAiProviderStore((state) => state.probeProvider);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AiProviderItem | null>(null);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const isAdmin = useMemo(
    () => user?.roles.some((role) => role.role_code === 'hospital_admin') ?? false,
    [user],
  );
  // 菜单权限兜底：能进入本页即有 ai-connections 菜单（hospital_admin）
  const canManage = isAdmin;
  const activeProvider = providers.find((item) => item.is_active);
  const configuredCount = providers.filter((item) => item.has_api_key).length;

  const handleCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleEdit = (item: AiProviderItem) => {
    setEditing(item);
    setModalOpen(true);
  };

  const handleActivate = async (item: AiProviderItem) => {
    try {
      await activateProvider(item.provider);
      message.success(`已将 ${item.display_name} 设为当前调用路由`);
    } catch {
      // 全局请求层已展示具体错误
    }
  };

  const handleDelete = async (item: AiProviderItem) => {
    try {
      await removeProvider(item.provider);
      message.success(`已删除 ${item.display_name}`);
    } catch {
      // 全局请求层已展示具体错误
    }
  };

  const handleProbe = async (item: AiProviderItem, mode: 'test' | 'models') => {
    const result = await probeProvider(item.provider, mode);
    if (!result) return;
    if (result.ok) {
      const modelText = result.models.length > 0 ? `，${result.models.length} 个可用模型` : '';
      message.success(
        `${item.display_name} 连通正常（${formatLatency(result.latency_ms)}${modelText}）`,
      );
    } else {
      message.warning(`${item.display_name} 探测失败：${result.error ?? '未知错误'}`);
    }
  };

  return (
    <div className="workbench-page aip-page">
      <PageHead
        crumbs={[]}
        title="AI 服务与 API Key"
        subtitle="统一管理 AI 模型供应商、API Key 与默认路由，无需在代码或 .env 中配置"
        actions={
          <>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadProviders()}>
              刷新
            </Button>
            {canManage ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                新建服务
              </Button>
            ) : null}
          </>
        }
      />

      <section className="aip-hero">
        <div className="aip-hero-stats">
          <div>
            <strong>{activeProvider?.display_name ?? '—'}</strong>
            <span>当前路由</span>
          </div>
          <div>
            <strong>{providers.length}</strong>
            <span>供应商</span>
          </div>
          <div>
            <strong>{configuredCount}</strong>
            <span>已配置凭据</span>
          </div>
          <div>
            <strong>{providers.length - configuredCount}</strong>
            <span>待配置</span>
          </div>
        </div>
        {!canManage ? (
          <Tag icon={<SafetyOutlined />} color="default">
            只读视图 · 仅医院管理员可编辑
          </Tag>
        ) : null}
      </section>

      {error ? (
        <Empty description={error} style={{ padding: '48px 0' }}>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadProviders()}>
            重新加载
          </Button>
        </Empty>
      ) : providers.length === 0 ? (
        <Empty
          description={loading ? '正在读取服务端配置' : '尚未配置任何 AI 供应商'}
          style={{ padding: '48px 0' }}
        >
          {canManage && !loading ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新建第一个服务
            </Button>
          ) : null}
        </Empty>
      ) : (
        <div className="aip-card-grid">
          {providers.map((item) => {
            const protocol = PROTOCOL_META[item.protocol] ?? PROTOCOL_META.openai;
            const probe = probes[item.provider];
            const busy = mutating === item.provider;
            const probingThis = probing === item.provider;
            return (
              <article key={item.id} className={`aip-card${item.is_active ? ' active' : ''}`}>
                <div className="aip-card-accent" style={{ background: protocol.accent }} />
                <header>
                  <div className="aip-card-title">
                    <h3>{item.display_name}</h3>
                    <span className="aip-card-provider">#{item.provider}</span>
                  </div>
                  <div className="aip-card-tags">
                    <Tag color={item.protocol === 'anthropic' ? 'purple' : 'orange'}>
                      {protocol.label}
                    </Tag>
                    {item.is_active ? (
                      <Tag icon={<CheckCircleFilled />} color="success">
                        当前路由
                      </Tag>
                    ) : item.has_api_key ? (
                      <Tag color="blue">已配置</Tag>
                    ) : (
                      <Tag color="error">缺少 API Key</Tag>
                    )}
                  </div>
                </header>
                <dl className="aip-card-fields">
                  <div>
                    <dt>地址</dt>
                    <dd>
                      <Tooltip title={item.base_url}>
                        <span className="aip-ellipsis">{item.base_url}</span>
                      </Tooltip>
                    </dd>
                  </div>
                  <div>
                    <dt>默认模型</dt>
                    <dd>{item.default_model || '—'}</dd>
                  </div>
                  <div>
                    <dt>凭据</dt>
                    <dd>
                      {item.has_api_key
                        ? `••••••${item.api_key_last4 ?? '••••'}`
                        : '未配置'}
                    </dd>
                  </div>
                  <div>
                    <dt>候选模型</dt>
                    <dd>{item.cached_models.length > 0 ? `${item.cached_models.length} 个` : '—'}</dd>
                  </div>
                </dl>
                {probe ? (
                  <Alert
                    className="aip-probe"
                    type={probe.ok ? 'success' : 'error'}
                    showIcon
                    icon={probe.ok ? <ThunderboltOutlined /> : <ReloadOutlined />}
                    message={
                      probe.ok
                        ? `连通正常 · 延迟 ${formatLatency(probe.latency_ms)}${
                            probe.models.length > 0 ? ` · ${probe.models.length} 个模型` : ''
                          }`
                        : '探测失败'
                    }
                    description={
                      probe.ok
                        ? probe.models.length > 0
                          ? probe.models.slice(0, 8).join('、') +
                            (probe.models.length > 8 ? ' …' : '')
                          : undefined
                        : probe.error ?? '未知错误'
                    }
                  />
                ) : null}
                {canManage ? (
                  <footer className="aip-card-actions">
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={probingThis}
                      onClick={() => void handleProbe(item, 'test')}
                    >
                      测速
                    </Button>
                    <Button
                      size="small"
                      icon={<CloudUploadOutlined />}
                      loading={probingThis}
                      onClick={() => void handleProbe(item, 'models')}
                    >
                      获取模型
                    </Button>
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => handleEdit(item)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      type={item.is_active ? 'default' : 'primary'}
                      icon={
                        item.is_active ? <CheckCircleFilled /> : <SyncOutlined spin={busy && !probingThis} />
                      }
                      disabled={item.is_active || !item.has_api_key || busy}
                      loading={busy && !probingThis}
                      onClick={() => void handleActivate(item)}
                    >
                      {item.is_active ? '当前路由' : item.has_api_key ? '设为默认' : '凭据未配置'}
                    </Button>
                    <Popconfirm
                      title="删除该 AI 服务？"
                      description="删除后无法恢复，正在使用该服务的调用会立即切换失败"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      disabled={item.is_active}
                      onConfirm={() => void handleDelete(item)}
                    >
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        disabled={item.is_active || busy}
                        title={item.is_active ? '当前路由不可删除' : '删除'}
                      />
                    </Popconfirm>
                  </footer>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <footer className="aip-note">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          API Key 在数据库以 AES-GCM 加密存储，前端永远拿不到明文；写操作仅医院管理员可执行并记录审计日志。
        </Typography.Text>
      </footer>

      {canManage ? (
        <ProviderFormModal
          open={modalOpen}
          initial={editing}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
