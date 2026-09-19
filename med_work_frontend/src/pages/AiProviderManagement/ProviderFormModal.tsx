import { useEffect, useState } from 'react';
import { App as AntApp, AutoComplete, Button, Form, Input, Modal, Radio, Space } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { fetchAiProviderModels, fetchAiProviderModelsDraft } from '@/services/api';
import { useAiProviderStore } from '@/stores/aiProviders';
import type { AiProviderItem, AiProtocol } from '@/types';

interface FormValues {
  provider: string;
  display_name: string;
  protocol: AiProtocol;
  base_url: string;
  api_key?: string;
  default_model: string;
}

export interface ProviderFormModalProps {
  open: boolean;
  /** null 表示新建，否则为编辑目标。 */
  initial: AiProviderItem | null;
  onClose: () => void;
}

const PROTOCOL_OPTIONS = [
  { label: 'OpenAI 兼容（DeepSeek / GLM / 中转等）', value: 'openai' },
  { label: 'Anthropic（Claude）', value: 'anthropic' },
];

const BASE_URL_PLACEHOLDER: Record<AiProtocol, string> = {
  openai: 'https://api.deepseek.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

export default function ProviderFormModal({ open, initial, onClose }: ProviderFormModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const mutating = useAiProviderStore((state) => state.mutating);
  const createProvider = useAiProviderStore((state) => state.createProvider);
  const updateProvider = useAiProviderStore((state) => state.updateProvider);

  const isEdit = initial !== null;
  const protocol = Form.useWatch('protocol', form) ?? 'openai';
  const [modelOptions, setModelOptions] = useState<{ value: string }[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      form.setFieldsValue({
        provider: initial.provider,
        display_name: initial.display_name,
        protocol: initial.protocol,
        base_url: initial.base_url,
        default_model: initial.default_model,
        api_key: undefined,
      });
    } else {
      form.resetFields();
    }
    setModelOptions((initial?.cached_models ?? []).map((model) => ({ value: model })));
  }, [open, initial, form]);

  const handleFetchModels = async () => {
    const values = form.getFieldsValue(['protocol', 'base_url', 'api_key', 'default_model']);
    setFetchingModels(true);
    try {
      // 编辑且 Key 留空 → 未改动凭据，用已保存配置拉取（还会回写 cached_models）；
      // 其余情况（新建 / 填了新 Key）→ 按表单草稿临时探测
      const useSaved = isEdit && initial !== null && !values.api_key;
      const result = useSaved && initial
        ? await fetchAiProviderModels(initial.provider)
        : await fetchAiProviderModelsDraft({
            protocol: values.protocol,
            base_url: values.base_url,
            api_key: values.api_key ?? '',
            default_model: values.default_model ?? '',
          });
      if (result.ok && result.models.length > 0) {
        setModelOptions(result.models.map((model) => ({ value: model })));
        message.success(`获取到 ${result.models.length} 个模型，请选择默认模型`);
      } else {
        message.warning(result.error || '未拉取到模型列表，请检查地址与 API Key');
      }
    } catch {
      // 全局层已提示
    } finally {
      setFetchingModels(false);
    }
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    try {
      if (isEdit && initial) {
        // api_key 留空表示保持原值；显式传空串表示清除
        const payload = values.api_key === undefined ? { ...values, api_key: null } : values;
        delete (payload as { provider?: string }).provider;
        await updateProvider(initial.provider, payload);
        message.success(`已更新 ${values.display_name}`);
      } else {
        await createProvider(values);
        message.success(`已创建 ${values.display_name}`);
      }
      onClose();
    } catch {
      // 校验失败或请求错误（全局层已提示）
    }
  };

  return (
    <Modal
      title={isEdit ? `编辑 · ${initial?.display_name}` : '新建 AI 服务'}
      open={open}
      width={600}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={mutating === 'create' || (isEdit && mutating === initial?.provider)}
      onOk={() => void handleOk()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          name="provider"
          label="供应商标识"
          rules={[
            { required: true, message: '请输入供应商标识' },
            {
              pattern: /^[a-z0-9][a-z0-9-]{1,31}$/,
              message: '仅支持小写字母、数字与连字符，2-32 位',
            },
          ]}
          extra={isEdit ? '创建后不可修改' : '全局唯一，如 deepseek / my-relay'}
        >
          <Input placeholder="deepseek" disabled={isEdit} maxLength={32} />
        </Form.Item>
        <Form.Item
          name="display_name"
          label="显示名称"
          rules={[{ required: true, message: '请输入显示名称' }]}
        >
          <Input placeholder="DeepSeek 官方" maxLength={128} />
        </Form.Item>
        <Form.Item name="protocol" label="协议" initialValue="openai" rules={[{ required: true }]}>
          <Radio.Group options={PROTOCOL_OPTIONS} optionType="button" buttonStyle="solid" />
        </Form.Item>
        <Form.Item
          name="base_url"
          label="Base URL"
          rules={[
            { required: true, message: '请输入 API 基础地址' },
            { pattern: /^https?:\/\//, message: '必须以 http:// 或 https:// 开头' },
          ]}
          extra="含版本前缀，如 https://api.deepseek.com/v1"
        >
          <Input placeholder={BASE_URL_PLACEHOLDER[protocol]} maxLength={512} />
        </Form.Item>
        <Form.Item
          name="api_key"
          label="API Key"
          extra={
            isEdit
              ? initial?.has_api_key
                ? `留空保持原值（当前 ••••••${initial.api_key_last4 ?? '••••'}）`
                : '尚未配置，填写后保存'
              : '仅保存在服务端数据库（AES-GCM 加密）'
          }
        >
          <Input.Password placeholder={isEdit ? '留空保持原值' : 'sk-...'} maxLength={512} allowClear />
        </Form.Item>
        <Form.Item
          name="default_model"
          label="默认模型"
          extra="点击右侧「获取模型」拉取上游可用模型，也可直接输入"
        >
          <Space.Compact style={{ width: '100%' }}>
            <AutoComplete
              placeholder={protocol === 'anthropic' ? 'claude-sonnet-4-5' : 'deepseek-chat'}
              options={modelOptions}
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
            <Button
              icon={<CloudDownloadOutlined />}
              loading={fetchingModels}
              onClick={() => void handleFetchModels()}
            >
              获取模型
            </Button>
          </Space.Compact>
        </Form.Item>
      </Form>
    </Modal>
  );
}
