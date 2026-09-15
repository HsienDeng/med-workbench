import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import PageHead from '@/components/PageHead';
import {
  DICTIONARY_CATEGORY_LABELS,
  useDictionaryStore,
} from '@/stores/dictionaries';
import { usePermission } from '@/utils/access';
import type {
  Dictionary,
  DictionaryCategory,
  DictionaryItem,
  DictionaryStatus,
} from '@/types';
import './index.css';

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '停用' },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

const CATEGORY_COLORS: Record<DictionaryCategory, string> = {
  clinical: 'blue',
  lab: 'cyan',
  coding: 'purple',
  business: 'gold',
};

interface DictFormValues {
  dict_code: string;
  dict_name: string;
  category: DictionaryCategory;
  status: DictionaryStatus;
  sort_order: number;
  description?: string;
}

interface ItemFormValues {
  item_code: string;
  item_label: string;
  item_value?: string;
  status: DictionaryStatus;
  sort_order: number;
  remark?: string;
}

export default function Dictionaries() {
  const { message } = AntApp.useApp();
  const can = usePermission();

  const categories = useDictionaryStore((state) => state.categories);
  const dictionaries = useDictionaryStore((state) => state.dictionaries);
  const dictLoading = useDictionaryStore((state) => state.dictLoading);
  const dictError = useDictionaryStore((state) => state.dictError);
  const dictTotal = useDictionaryStore((state) => state.dictTotal);
  const dictPage = useDictionaryStore((state) => state.dictPage);
  const dictPageSize = useDictionaryStore((state) => state.dictPageSize);
  const keyword = useDictionaryStore((state) => state.keyword);
  const category = useDictionaryStore((state) => state.category);
  const status = useDictionaryStore((state) => state.status);

  const selectedDictId = useDictionaryStore((state) => state.selectedDictId);
  const items = useDictionaryStore((state) => state.items);
  const itemLoading = useDictionaryStore((state) => state.itemLoading);
  const itemError = useDictionaryStore((state) => state.itemError);
  const itemTotal = useDictionaryStore((state) => state.itemTotal);
  const itemPage = useDictionaryStore((state) => state.itemPage);
  const itemPageSize = useDictionaryStore((state) => state.itemPageSize);
  const itemKeyword = useDictionaryStore((state) => state.itemKeyword);
  const itemStatus = useDictionaryStore((state) => state.itemStatus);

  const submitting = useDictionaryStore((state) => state.submitting);
  const loadCategories = useDictionaryStore((state) => state.loadCategories);
  const setKeyword = useDictionaryStore((state) => state.setKeyword);
  const setCategory = useDictionaryStore((state) => state.setCategory);
  const setStatus = useDictionaryStore((state) => state.setStatus);
  const setDictPage = useDictionaryStore((state) => state.setDictPage);
  const loadDictionaries = useDictionaryStore((state) => state.loadDictionaries);
  const createDictionaryAction = useDictionaryStore((state) => state.createDictionary);
  const updateDictionaryAction = useDictionaryStore((state) => state.updateDictionary);
  const removeDictionary = useDictionaryStore((state) => state.removeDictionary);
  const selectDictionary = useDictionaryStore((state) => state.selectDictionary);
  const setItemKeyword = useDictionaryStore((state) => state.setItemKeyword);
  const setItemStatus = useDictionaryStore((state) => state.setItemStatus);
  const setItemPage = useDictionaryStore((state) => state.setItemPage);
  const loadItems = useDictionaryStore((state) => state.loadItems);
  const createItemAction = useDictionaryStore((state) => state.createItem);
  const batchCreateItems = useDictionaryStore((state) => state.batchCreateItems);
  const updateItemAction = useDictionaryStore((state) => state.updateItem);
  const removeItem = useDictionaryStore((state) => state.removeItem);

  const [searchText, setSearchText] = useState(keyword);
  const [itemSearchText, setItemSearchText] = useState(itemKeyword);
  const [dictModalOpen, setDictModalOpen] = useState(false);
  const [editingDict, setEditingDict] = useState<Dictionary | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DictionaryItem | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [dictForm] = Form.useForm<DictFormValues>();
  const [itemForm] = Form.useForm<ItemFormValues>();

  // 字典维护能力与后端 dictionary:manage 权限点对齐（医院管理员默认持有）
  const canManage = can('dictionary:manage');
  const activeDict = useMemo(
    () => dictionaries.find((item) => item.id === selectedDictId) ?? null,
    [dictionaries, selectedDictId],
  );

  useEffect(() => {
    void loadCategories();
    void loadDictionaries();
  }, [loadCategories, loadDictionaries]);

  useEffect(() => {
    void loadDictionaries();
  }, [keyword, category, status, dictPage, dictPageSize, loadDictionaries]);

  useEffect(() => {
    void loadItems();
  }, [selectedDictId, itemKeyword, itemStatus, itemPage, itemPageSize, loadItems]);

  // 首屏默认选中第一个字典，避免右侧空白
  useEffect(() => {
    if (selectedDictId === null && dictionaries.length > 0) {
      selectDictionary(dictionaries[0].id);
    }
  }, [dictionaries, selectedDictId, selectDictionary]);

  const handleSearch = useCallback(() => {
    setKeyword(searchText.trim());
  }, [searchText, setKeyword]);

  const handleItemSearch = useCallback(() => {
    setItemKeyword(itemSearchText.trim());
  }, [itemSearchText, setItemKeyword]);

  const openCreateDict = () => {
    setEditingDict(null);
    dictForm.setFieldsValue({
      dict_code: '',
      dict_name: '',
      category: 'business',
      status: 'active',
      sort_order: 0,
      description: '',
    });
    setDictModalOpen(true);
  };

  const openEditDict = (dict: Dictionary) => {
    setEditingDict(dict);
    dictForm.setFieldsValue({
      dict_code: dict.dict_code,
      dict_name: dict.dict_name,
      category: dict.category,
      status: dict.status,
      sort_order: dict.sort_order,
      description: dict.description ?? '',
    });
    setDictModalOpen(true);
  };

  const submitDict = async () => {
    const values = await dictForm.validateFields();
    const payload = {
      dict_code: values.dict_code.trim(),
      dict_name: values.dict_name.trim(),
      category: values.category,
      status: values.status,
      sort_order: values.sort_order ?? 0,
      description: values.description?.trim() || null,
    };
    try {
      if (editingDict) {
        const { dict_code: _code, ...updatePayload } = payload;
        await updateDictionaryAction(editingDict.id, updatePayload);
        message.success('字典已更新');
      } else {
        await createDictionaryAction(payload);
        message.success('字典已创建');
      }
      setDictModalOpen(false);
    } catch {
      // 请求层已提示具体错误
    }
  };

  const handleDeleteDict = async (dict: Dictionary) => {
    try {
      await removeDictionary(dict.id);
      message.success(`字典「${dict.dict_name}」已删除`);
    } catch {
      // 请求层已提示具体错误
    }
  };

  const openCreateItem = () => {
    if (!activeDict) return;
    setEditingItem(null);
    itemForm.setFieldsValue({
      item_code: '',
      item_label: '',
      item_value: '',
      status: 'active',
      sort_order: (items.length ? items[items.length - 1].sort_order : 0) + 10,
      remark: '',
    });
    setItemModalOpen(true);
  };

  const openEditItem = (item: DictionaryItem) => {
    setEditingItem(item);
    itemForm.setFieldsValue({
      item_code: item.item_code,
      item_label: item.item_label,
      item_value: item.item_value ?? '',
      status: item.status,
      sort_order: item.sort_order,
      remark: item.remark ?? '',
    });
    setItemModalOpen(true);
  };

  const submitItem = async () => {
    if (!activeDict) return;
    const values = await itemForm.validateFields();
    const payload = {
      item_code: values.item_code.trim(),
      item_label: values.item_label.trim(),
      item_value: values.item_value?.trim() || null,
      status: values.status,
      sort_order: values.sort_order ?? 0,
      remark: values.remark?.trim() || null,
    };
    try {
      if (editingItem) {
        const { item_code: _code, ...updatePayload } = payload;
        await updateItemAction(editingItem.id, updatePayload);
        message.success('字典项已更新');
      } else {
        await createItemAction(activeDict.id, payload);
        message.success('字典项已新增');
      }
      setItemModalOpen(false);
    } catch {
      // 请求层已提示具体错误
    }
  };

  const submitBatch = async () => {
    if (!activeDict) return;
    try {
      const created = await batchCreateItems(activeDict.id, batchText);
      message.success(`已导入 ${created} 个字典项`);
      setBatchModalOpen(false);
      setBatchText('');
    } catch {
      // 请求层已提示具体错误
    }
  };

  const handleToggleItem = async (item: DictionaryItem) => {
    try {
      await updateItemAction(item.id, { status: item.status === 'active' ? 'disabled' : 'active' });
      message.success(item.status === 'active' ? '已停用' : '已启用');
    } catch {
      // 请求层已提示具体错误
    }
  };

  const handleDeleteItem = async (item: DictionaryItem) => {
    try {
      await removeItem(item.id);
      message.success('字典项已删除');
    } catch {
      // 请求层已提示具体错误
    }
  };

  const itemColumns: ColumnsType<DictionaryItem> = [
    {
      title: '编码',
      dataIndex: 'item_code',
      width: 160,
      render: (code: string) => <code className="dict-code">{code}</code>,
    },
    { title: '显示名称', dataIndex: 'item_label', ellipsis: true },
    {
      title: '项值',
      dataIndex: 'item_value',
      width: 160,
      render: (value: string | null) => value || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 80,
      align: 'right',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (itemStatusValue: DictionaryStatus) => (
        <Tag color={itemStatusValue === 'active' ? 'success' : 'default'}>
          {itemStatusValue === 'active' ? '启用' : '停用'}
        </Tag>
      ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      ellipsis: true,
      render: (remark: string | null) => remark || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 150,
      render: (value: string) => (
        <Typography.Text type="secondary">{dayjs(value).format('YYYY-MM-DD HH:mm')}</Typography.Text>
      ),
    },
  ];

  if (canManage) {
    itemColumns.push({
      title: '操作',
      key: 'action',
      width: 170,
      fixed: 'right',
      render: (_, item) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditItem(item)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => void handleToggleItem(item)}
            disabled={submitting}
          >
            {item.status === 'active' ? '停用' : '启用'}
          </Button>
          <Popconfirm
            title="删除该字典项？"
            description="删除后不可恢复，引用该编码的下拉将不再展示此项。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDeleteItem(item)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={submitting}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    });
  }

  return (
    <div className="workbench-page dict-page">
      <PageHead
        crumbs={[]}
        title="字典管理"
        subtitle="统一维护平台数据字典，供文档分类、患者档案、分析任务等下拉选项复用"
        actions={
          <>
            <Button
              icon={<ReloadOutlined />}
              loading={dictLoading}
              onClick={() => {
                void loadDictionaries();
                void loadItems();
              }}
            >
              刷新
            </Button>
            {canManage && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDict}>
                新建字典
              </Button>
            )}
          </>
        }
      />

      <div className="dict-layout">
        <aside className="dict-sidebar">
          <Card
            title={
              <Flex vertical gap={2}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  字典列表
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  共 {dictTotal} 个字典
                </Typography.Text>
              </Flex>
            }
            styles={{ body: { padding: 12 } }}
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Input.Search
                placeholder="搜索编码或名称"
                value={searchText}
                allowClear
                onChange={(event) => setSearchText(event.target.value)}
                onSearch={handleSearch}
                onPressEnter={handleSearch}
              />
              <Select
                placeholder="全部分类"
                value={category || undefined}
                allowClear
                style={{ width: '100%' }}
                onChange={(value: DictionaryCategory | undefined) => setCategory(value ?? '')}
                options={categories.map((item) => ({ value: item.value, label: item.label }))}
              />
              <Segmented
                block
                value={status === '' ? 'all' : status}
                onChange={(value) => setStatus(value === 'all' ? '' : (value as DictionaryStatus))}
                options={STATUS_OPTIONS.map(({ label, value }) => ({ label, value }))}
              />
            </Space>

            <div className="dict-list">
              {dictError ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={dictError}
                  style={{ padding: '24px 0' }}
                >
                  <Button size="small" onClick={() => void loadDictionaries()}>
                    重新加载
                  </Button>
                </Empty>
              ) : dictionaries.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={dictLoading ? '正在加载' : '暂无符合条件的字典'}
                  style={{ padding: '24px 0' }}
                />
              ) : (
                dictionaries.map((dict) => (
                  <div
                    key={dict.id}
                    role="button"
                    tabIndex={0}
                    className={`dict-list-item${dict.id === selectedDictId ? ' active' : ''}`}
                    onClick={() => selectDictionary(dict.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectDictionary(dict.id);
                      }
                    }}
                  >
                    <div className="dict-item-main">
                      <div className="dict-item-title">
                        <span className="dict-item-name" title={dict.dict_name}>
                          {dict.dict_name}
                        </span>
                        {dict.builtin && (
                          <Tooltip title="内置字典，不可删除">
                            <SafetyCertificateOutlined className="dict-builtin-icon" />
                          </Tooltip>
                        )}
                        <code className="dict-item-code" title={dict.dict_code}>
                          {dict.dict_code}
                        </code>
                      </div>
                      <div className="dict-item-meta">
                        <Tag color={CATEGORY_COLORS[dict.category]} style={{ marginInlineEnd: 0 }}>
                          {DICTIONARY_CATEGORY_LABELS[dict.category]}
                        </Tag>
                        <span className="dict-item-count">{dict.item_count} 项</span>
                        {dict.status === 'disabled' && <Tag color="default">停用</Tag>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="dict-item-actions">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditDict(dict);
                          }}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title={`删除字典「${dict.dict_name}」？`}
                          description={dict.builtin ? '内置字典不可删除' : '仅当字典下无字典项时可删除'}
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true, disabled: dict.builtin || dict.item_count > 0 }}
                          onConfirm={(event) => {
                            event?.stopPropagation();
                            void handleDeleteDict(dict);
                          }}
                          onCancel={(event) => event?.stopPropagation()}
                        >
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            disabled={dict.builtin || dict.item_count > 0}
                            onClick={(event) => event.stopPropagation()}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {dictTotal > dictPageSize && (
              <Flex justify="center" style={{ marginTop: 8 }}>
                <Space size={6}>
                  <Button
                    size="small"
                    disabled={dictPage <= 1}
                    onClick={() => setDictPage(dictPage - 1)}
                  >
                    上一页
                  </Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dictPage} / {Math.ceil(dictTotal / dictPageSize)}
                  </Typography.Text>
                  <Button
                    size="small"
                    disabled={dictPage >= Math.ceil(dictTotal / dictPageSize)}
                    onClick={() => setDictPage(dictPage + 1)}
                  >
                    下一页
                  </Button>
                </Space>
              </Flex>
            )}
          </Card>
        </aside>

        <section className="dict-main">
          <Card
            title={
              <Flex vertical gap={2}>
                <Typography.Text strong style={{ fontSize: 15 }}>
                  {activeDict ? (
                    <>
                      <BookOutlined /> {activeDict.dict_name}
                    </>
                  ) : (
                    '字典项'
                  )}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {activeDict
                    ? `${activeDict.dict_code} · 共 ${itemTotal} 个字典项`
                    : '请先从左侧选择一个字典'}
                </Typography.Text>
              </Flex>
            }
            extra={
              activeDict && canManage ? (
                <Space>
                  <Button icon={<ImportOutlined />} onClick={() => setBatchModalOpen(true)}>
                    批量导入
                  </Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateItem}>
                    新增字典项
                  </Button>
                </Space>
              ) : undefined
            }
            styles={{ body: { padding: 16 } }}
          >
            {!activeDict ? (
              <Empty
                description="从左侧选择一个字典以查看其字典项"
                style={{ padding: '64px 0' }}
                image={<AppstoreOutlined style={{ fontSize: 48, color: '#c8d3e0' }} />}
              />
            ) : (
              <>
                <Flex gap={8} wrap style={{ marginBottom: 12 }}>
                  <Input.Search
                    placeholder="搜索编码或显示名称"
                    allowClear
                    style={{ width: 260 }}
                    value={itemSearchText}
                    onChange={(event) => setItemSearchText(event.target.value)}
                    onSearch={handleItemSearch}
                    onPressEnter={handleItemSearch}
                  />
                  <Segmented
                    value={itemStatus === '' ? 'all' : itemStatus}
                    onChange={(value) =>
                      setItemStatus(value === 'all' ? '' : (value as DictionaryStatus))
                    }
                    options={STATUS_OPTIONS.map(({ label, value }) => ({ label, value }))}
                  />
                </Flex>
                <Table<DictionaryItem>
                  rowKey="id"
                  size="middle"
                  loading={itemLoading}
                  columns={itemColumns}
                  dataSource={items}
                  scroll={{ x: 900 }}
                  locale={{
                    emptyText: itemError ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={itemError} />
                    ) : (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="该字典下暂无字典项，点击「新增字典项」开始维护"
                      />
                    ),
                  }}
                  pagination={{
                    current: itemPage,
                    pageSize: itemPageSize,
                    total: itemTotal,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                    showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 项`,
                    onChange: (page, pageSize) => setItemPage(page, pageSize),
                  }}
                />
              </>
            )}
          </Card>
        </section>
      </div>

      <Modal
        title={editingDict ? '编辑字典' : '新建字典'}
        open={dictModalOpen}
        onOk={() => void submitDict()}
        onCancel={() => setDictModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form<DictFormValues> form={dictForm} layout="vertical" preserve={false}>
          <Form.Item
            name="dict_code"
            label="字典编码"
            rules={[
              { required: true, message: '请输入字典编码' },
              { pattern: /^[A-Za-z0-9_]+$/, message: '仅支持字母、数字与下划线' },
            ]}
            extra={editingDict ? '编码创建后不可修改' : '程序引用标识，创建后不可修改'}
          >
            <Input placeholder="如 department" disabled={Boolean(editingDict)} />
          </Form.Item>
          <Form.Item
            name="dict_name"
            label="字典名称"
            rules={[{ required: true, message: '请输入字典名称' }]}
          >
            <Input placeholder="如 临床科室" maxLength={128} />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true }]}>
            <Select
              options={categories.map((item) => ({ value: item.value, label: item.label }))}
            />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
          <Form.Item name="sort_order" label="排序" rules={[{ required: true }]}>
            <InputNumber min={0} max={9999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="该字典的用途说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingItem ? '编辑字典项' : '新增字典项'}
        open={itemModalOpen}
        onOk={() => void submitItem()}
        onCancel={() => setItemModalOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form<ItemFormValues> form={itemForm} layout="vertical" preserve={false}>
          <Form.Item
            name="item_code"
            label="项编码"
            rules={[
              { required: true, message: '请输入项编码' },
              { pattern: /^[A-Za-z0-9_.\-]+$/, message: '仅支持字母、数字、下划线、点与短横线' },
            ]}
            extra={editingItem ? '编码创建后不可修改' : undefined}
          >
            <Input placeholder="如 cardiology" disabled={Boolean(editingItem)} />
          </Form.Item>
          <Form.Item
            name="item_label"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="如 心血管内科" maxLength={255} />
          </Form.Item>
          <Form.Item name="item_value" label="项值" extra="留空则默认与项编码相同">
            <Input placeholder="如 cardiology" maxLength={255} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
          <Form.Item name="sort_order" label="排序" rules={[{ required: true }]}>
            <InputNumber min={0} max={9999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`批量导入 · ${activeDict?.dict_name ?? ''}`}
        open={batchModalOpen}
        onOk={() => void submitBatch()}
        onCancel={() => {
          setBatchModalOpen(false);
          setBatchText('');
        }}
        confirmLoading={submitting}
        okText="导入"
        cancelText="取消"
        okButtonProps={{ disabled: !batchText.trim() }}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          每行一条，格式 <code>编码,显示名,项值</code>（项值可省略，缺省同编码）。
          支持逗号、分号或换行分隔；与已有编码重复的行会自动跳过。
        </Typography.Paragraph>
        <Input.TextArea
          rows={10}
          value={batchText}
          onChange={(event) => setBatchText(event.target.value)}
          placeholder={'cardiology,心血管内科\nneurology,神经内科\npediatrics,儿科'}
        />
      </Modal>
    </div>
  );
}
