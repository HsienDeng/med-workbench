/**
 * 提示词模板卡片网格 + 编辑弹窗。
 * 由「提示词管理」页面与 Assistant 内的弹窗共用；不区分预设与个人模板，全部可编辑。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Tooltip,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  FileAddOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  createPrompt,
  deletePrompt,
  listPrompts,
  updatePrompt,
  type PromptTemplate,
} from '@/services/prompts';
import './index.css';

type FormValues = { name: string; description?: string; content: string };

interface Props {
  /** 增删改后回调（通知父级刷新下拉选项） */
  onChanged?: (prompts: PromptTemplate[]) => void;
  /** 编辑弹窗宽度（页面 680 / 弹窗场景可用默认） */
  modalWidth?: number;
}

export default function PromptManagePanel({ onChanged, modalWidth = 640 }: Props) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(
    () => prompts.filter((item) => matchKeyword(item, keyword)),
    [prompts, keyword],
  );

  const reload = async () => {
    setLoading(true);
    try {
      const list = await listPrompts();
      setPrompts(list);
      onChanged?.(list);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点击卡片：直接进入编辑 */
  const openEdit = (item: PromptTemplate) => {
    setSelected(item);
    setCreating(false);
    setEditOpen(true);
    form.setFieldsValue({
      name: item.name,
      description: item.description ?? '',
      content: item.content,
    });
  };

  /** 新建空白模板 */
  const openCreate = () => {
    setSelected(null);
    setCreating(true);
    setEditOpen(true);
    form.resetFields();
  };

  /** 以任意模板为底稿复制新建 */
  const openDuplicate = (item: PromptTemplate) => {
    setSelected(null);
    setCreating(true);
    setEditOpen(true);
    form.setFieldsValue({
      name: `${item.name} 副本`,
      description: item.description ?? '',
      content: item.content,
    });
  };

  const closeEdit = () => {
    setEditOpen(false);
    setCreating(false);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (creating) {
        const created = await createPrompt(values);
        await reload();
        message.success('提示词已创建');
        setSelected(created);
        setCreating(false);
        form.setFieldsValue({
          name: created.name,
          description: created.description ?? '',
          content: created.content,
        });
      } else if (selected) {
        await updatePrompt(selected.id, values);
        await reload();
        message.success('提示词已保存');
      }
    } catch (error) {
      if (error instanceof Error && error.message) message.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: PromptTemplate) => {
    try {
      await deletePrompt(item.id);
      message.success(`已删除「${item.name}」`);
      if (selected?.id === item.id) closeEdit();
      await reload();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const renderCard = (item: PromptTemplate) => (
    <div
      key={item.id}
      className={`prompt-card${selected?.id === item.id && editOpen ? ' prompt-card--active' : ''}`}
      onClick={() => openEdit(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && openEdit(item)}
      aria-label={`编辑提示词 ${item.name}`}
    >
      <div className="prompt-card-icon">
        <ThunderboltOutlined />
      </div>
      <div className="prompt-card-body">
        <div className="prompt-card-title" title={item.name}>
          {item.name}
        </div>
        <div className="prompt-card-desc" title={item.description ?? ''}>
          {item.description || '暂无描述'}
        </div>
        <div className="prompt-card-preview">{item.content}</div>
      </div>
      <Popconfirm
        title="删除提示词"
        description={`确定删除「${item.name}」？引用它的历史会话将回退为默认助手。`}
        okText="删除"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onConfirm={(e) => {
          e?.stopPropagation();
          void handleDelete(item);
        }}
      >
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          className="prompt-card-delete"
          aria-label={`删除 ${item.name}`}
          onClick={(e) => e.stopPropagation()}
        />
      </Popconfirm>
    </div>
  );

  return (
    <div className="prompt-panel">
      <div className="prompt-panel-toolbar">
        <Input
          className="prompt-panel-search"
          prefix={<SearchOutlined />}
          placeholder="搜索提示词名称或描述"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索提示词"
        />
        <span className="prompt-panel-count">共 {prompts.length} 个模板</span>
        <Tooltip title="刷新列表">
          <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading} aria-label="刷新列表" />
        </Tooltip>
        <Button type="primary" icon={<FileAddOutlined />} onClick={openCreate}>
          新建提示词
        </Button>
      </div>

      {loading ? (
        <div className="prompt-card-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="prompt-card">
              <Skeleton.Node active style={{ width: 36, height: 36 }} />
              <div className="prompt-card-body">
                <Skeleton active title={{ width: '60%' }} paragraph={{ rows: 2 }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length ? (
        <div className="prompt-card-grid">
          {filtered.map(renderCard)}
        </div>
      ) : prompts.length === 0 ? (
        <Empty description="暂无提示词，点击右上角「新建提示词」创建" style={{ margin: '48px 0' }} />
      ) : (
        <Empty description="没有匹配的提示词" style={{ margin: '48px 0' }} />
      )}

      <Modal
        open={editOpen}
        onCancel={closeEdit}
        width={modalWidth}
        destroyOnHidden
        className="prompt-detail-modal"
        title={
          <span className="prompt-drawer-title">
            {creating ? '新建提示词' : `编辑：${selected?.name ?? ''}`}
          </span>
        }
        footer={
          creating ? (
            <div className="prompt-drawer-footer">
              <Button onClick={closeEdit}>取 消</Button>
              <Button type="primary" loading={saving} onClick={() => void handleSave()}>
                保 存
              </Button>
            </div>
          ) : selected ? (
            <div className="prompt-drawer-footer">
              <Popconfirm
                title="删除提示词"
                description={`确定删除「${selected.name}」？引用它的历史会话将回退为默认助手。`}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                onConfirm={() => void handleDelete(selected)}
              >
                <Button danger icon={<DeleteOutlined />}>删 除</Button>
              </Popconfirm>
              <div className="prompt-drawer-footer-spacer" />
              <Button icon={<CopyOutlined />} onClick={() => openDuplicate(selected)}>
                复制新建
              </Button>
              <Button onClick={closeEdit}>取 消</Button>
              <Button type="primary" loading={saving} onClick={() => void handleSave()}>
                保 存
              </Button>
            </div>
          ) : null
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, whitespace: true, message: '请输入名称' }]}
          >
            <Input maxLength={64} placeholder="如：病历质控审查" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input maxLength={255} placeholder="一句话说明用途（可选）" />
          </Form.Item>
          <Form.Item
            name="content"
            label="提示词内容"
            rules={[{ required: true, whitespace: true, message: '请输入提示词内容' }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 12, maxRows: 20 }}
              placeholder="设定 AI 在该提示词下的角色与回答要求…"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 名称/描述大小写不敏感的包含匹配 */
function matchKeyword(item: PromptTemplate, keyword: string): boolean {
  if (!keyword.trim()) return true;
  const k = keyword.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(k) ||
    (item.description ?? '').toLowerCase().includes(k)
  );
}
