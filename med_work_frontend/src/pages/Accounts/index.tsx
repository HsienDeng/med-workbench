import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Divider,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnlockOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageHead from '@/components/PageHead';
import PermGate from '@/components/PermGate';
import { useAppStore } from '@/stores/app';
import {
  batchImportAccounts,
  createAccount,
  deleteAccount,
  getAccountOptions,
  getAccounts,
  resetAccountPassword,
  setAccountStatus,
  updateAccount,
} from '@/services/accounts';
import type {
  AccountBatchImportResult,
  AccountGender,
  AccountImportCreated,
  AccountItem,
  AccountOptions,
  AccountStatus,
} from '@/types';

/** 账号状态 → 展示文案与 Tag 颜色 */
const STATUS_META: Record<AccountStatus, { label: string; color: string }> = {
  pending: { label: '待启用', color: 'warning' },
  active: { label: '启用', color: 'success' },
  locked: { label: '已锁定', color: 'error' },
  disabled: { label: '已停用', color: 'default' },
};

const GENDER_OPTIONS: Array<{ value: AccountGender; label: string }> = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'unknown', label: '未填写' },
];

const GENDER_LABEL: Record<AccountGender, string> = {
  male: '男',
  female: '女',
  unknown: '',
};

/** 角色 → Tag 颜色（系统内置角色给出语义色，自定义角色回退蓝色） */
const ROLE_COLORS: Record<string, string> = {
  hospital_admin: 'volcano',
  doctor: 'geekblue',
  knowledge_admin: 'cyan',
  auditor: 'purple',
};

const ROLE_ORDER: string[] = ['hospital_admin', 'doctor', 'knowledge_admin', 'auditor'];

const EMPTY_TEXT = '—';

function formatTime(iso: string | null): string {
  if (!iso) return EMPTY_TEXT;
  return iso.replace('T', ' ').slice(0, 16);
}

function sortRoles(roles: AccountItem['roles']): AccountItem['roles'] {
  return [...roles].sort(
    (a, b) => (ROLE_ORDER.indexOf(a.role_code) || 9) - (ROLE_ORDER.indexOf(b.role_code) || 9),
  );
}

/** 复制文本到剪贴板 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

interface FilterState {
  keyword: string;
  status: AccountStatus | '';
  roleCode: string;
  departmentId: number | undefined;
}

interface FormValues {
  username?: string;
  real_name?: string;
  employee_no?: string;
  gender?: AccountGender | undefined;
  professional_title?: string;
  department_id?: number | undefined;
  role_ids?: number[];
  password?: string;
  status: AccountStatus;
}

type DrawerMode = 'create' | 'edit' | null;

export default function Accounts() {
  const { message } = AntApp.useApp();
  const currentUser = useAppStore((state) => state.user);
  const currentUserId = currentUser?.id ?? 0;

  const [form] = Form.useForm<FormValues>();

  // ---------- 列表与筛选 ----------
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AccountItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    keyword: '',
    status: '',
    roleCode: '',
    departmentId: undefined,
  });

  // ---------- 下拉数据 ----------
  const [options, setOptions] = useState<AccountOptions>({ roles: [], departments: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);

  // ---------- 新建 / 编辑 ----------
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editing, setEditing] = useState<AccountItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ---------- 初始密码 / 重置结果 ----------
  const [createdAccount, setCreatedAccount] = useState<{ username: string; password: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<AccountItem | null>(null);
  /** 输入框内手动输入的密码（尚未生效） */
  const [resetDraft, setResetDraft] = useState('');
  /** 重置成功后由后端返回的新密码，非空即视为本次重置已完成 */
  const [resetDone, setResetDone] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  // ---------- 批量导入 ----------
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<AccountBatchImportResult | null>(null);

  const roleOptions = useMemo(
    () =>
      options.roles.map((role) => ({
        value: role.id,
        label: role.role_name,
        roleCode: role.role_code,
        description:
          editing && editing.id === currentUserId && role.role_code === 'hospital_admin'
            ? '当前登录账号，不可移除管理员角色'
            : role.description,
        disabled:
          editing?.id === currentUserId && role.role_code === 'hospital_admin' ? true : undefined,
      })),
    [options.roles, editing, currentUserId],
  );

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      setOptions(await getAccountOptions());
    } catch {
      // 请求层已提示
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  // ---------- 列表加载 ----------
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAccounts({
        page,
        page_size: pageSize,
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
        role_code: filters.roleCode || undefined,
        department_id: filters.departmentId,
      });
      setRows(res.items);
      setTotal(res.total);
    } catch {
      // 请求层已提示
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = useCallback((patch: Partial<FilterState>) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSearch = () => {
    const keyword = searchText.trim();
    if (keyword === filters.keyword) void load();
    else applyFilters({ keyword });
  };

  const handleResetFilters = () => {
    setSearchText('');
    setPage(1);
    setFilters({ keyword: '', status: '', roleCode: '', departmentId: undefined });
  };

  // ---------- 新建 / 编辑 ----------
  const openCreate = () => {
    setEditing(null);
    setDrawerMode('create');
    form.resetFields();
    form.setFieldsValue({
      gender: 'unknown',
      role_ids: [],
      status: 'active',
      password: '',
    });
    setDrawerOpen(true);
  };

  const openEdit = (item: AccountItem) => {
    setEditing(item);
    setDrawerMode('edit');
    form.resetFields();
    form.setFieldsValue({
      real_name: item.real_name,
      employee_no: item.employee_no ?? '',
      gender: item.gender ?? 'unknown',
      professional_title: item.professional_title ?? '',
      department_id: item.primary_department_id ?? undefined,
      role_ids: item.roles.map((role) => role.id),
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (submitting) return;
    setDrawerOpen(false);
    setDrawerMode(null);
    setEditing(null);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (drawerMode === 'create') {
        const result = await createAccount({
          username: (values.username ?? '').trim(),
          real_name: (values.real_name ?? '').trim(),
          employee_no: values.employee_no?.trim() || null,
          gender: values.gender ?? 'unknown',
          professional_title: values.professional_title?.trim() || null,
          department_id: values.department_id ?? null,
          role_ids: values.role_ids ?? [],
          password: values.password?.trim() || null,
          status: values.status,
        });
        if (result.password) {
          setCreatedAccount({ username: result.username, password: result.password });
        }
        message.success(`账号「${result.real_name}」已创建`);
      } else if (editing) {
        await updateAccount(editing.id, {
          real_name: (values.real_name ?? '').trim(),
          employee_no: values.employee_no?.trim() || null,
          gender: values.gender ?? 'unknown',
          professional_title: values.professional_title?.trim() || null,
          department_id: values.department_id ?? null,
          role_ids: values.role_ids ?? [],
        });
        message.success('账号信息已更新');
      }
      setDrawerOpen(false);
      void load();
    } catch {
      // 请求层已提示具体错误（含不能移除自身管理员等）
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- 状态操作 ----------
  const handleStatusChange = async (item: AccountItem, status: AccountStatus, actionText: string) => {
    try {
      await setAccountStatus(item.id, status);
      message.success(`${item.real_name} 已${actionText}`);
      void load();
    } catch {
      // 请求层已提示
    }
  };

  // ---------- 重置密码 ----------
  const openReset = (item: AccountItem) => {
    setResetTarget(item);
    setResetDraft('');
    setResetDone(null);
    setResetSubmitting(false);
  };

  const handleResetSubmit = async (generate: boolean) => {
    if (!resetTarget) return;
    if (!generate && !resetDraft.trim()) {
      message.warning('请输入新密码，或点击「自动生成」');
      return;
    }
    setResetSubmitting(true);
    try {
      const password = generate ? undefined : resetDraft.trim() || undefined;
      const result = await resetAccountPassword(resetTarget.id, password);
      setResetDone(result.password);
      message.success(`已重置 ${resetTarget.real_name} 的密码，请妥善保存`);
      void load();
    } catch {
      // 请求层已提示
    } finally {
      setResetSubmitting(false);
    }
  };

  // ---------- 删除 ----------
  const handleDelete = async (item: AccountItem) => {
    try {
      await deleteAccount(item.id);
      message.success(`账号「${item.username}」已删除`);
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else void load();
    } catch {
      // 请求层已提示
    }
  };

  // ---------- 批量导入 ----------
  const openImport = () => {
    setImportText('');
    setImportResult(null);
    setImportOpen(true);
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      const result = await batchImportAccounts(importText);
      setImportResult(result);
      message.success(`成功创建 ${result.created} 个账号`);
      void load();
    } catch {
      // 请求层已提示
    } finally {
      setImporting(false);
    }
  };

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyText(text);
    message[ok ? 'success' : 'error'](ok ? `${label}已复制` : '复制失败，请手动选择复制');
  };

  // ---------- 表格 ----------
  const isSelf = (item: AccountItem) => item.id === currentUserId;

  const columns = useMemo<ColumnsType<AccountItem>>(
    () => [
      {
        title: '登录账号',
        dataIndex: 'username',
        width: 160,
        ellipsis: true,
        render: (username: string, record) => (
          <Space size={4}>
            <Typography.Text style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>
              {username}
            </Typography.Text>
            {isSelf(record) && (
              <Tooltip title="当前登录账号">
                <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                  我
                </Tag>
              </Tooltip>
            )}
            {record.must_change_password && (
              <Tooltip title="该账号登录后需修改初始密码">
                <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                  待改密
                </Tag>
              </Tooltip>
            )}
          </Space>
        ),
      },
      {
        title: '姓名',
        dataIndex: 'real_name',
        ellipsis: true,
        render: (name: string, record) => (
          <div style={{ lineHeight: 1.4 }}>
            <Typography.Text>{name}</Typography.Text>
            {record.gender && record.gender !== 'unknown' && (
              <Typography.Text type="secondary" style={{ marginInlineStart: 6, fontSize: 12 }}>
                {GENDER_LABEL[record.gender]}
              </Typography.Text>
            )}
            {record.professional_title && (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {record.professional_title}
              </Typography.Text>
            )}
          </div>
        ),
      },
      {
        title: '工号',
        dataIndex: 'employee_no',
        width: 110,
        ellipsis: true,
        render: (value: string | null) => value || EMPTY_TEXT,
      },
      {
        title: '所属科室',
        dataIndex: 'department_name',
        ellipsis: true,
        render: (value: string | null) => value || EMPTY_TEXT,
      },
      {
        title: '角色',
        dataIndex: 'roles',
        key: 'roles',
        ellipsis: true,
        render: (roles: AccountItem['roles']) => {
          const sorted = sortRoles(roles);
          if (!sorted.length) return <Typography.Text type="secondary">无</Typography.Text>;
          const shown = sorted.slice(0, 2);
          const rest = sorted.slice(2);
          return (
            <Space size={4} wrap>
              {shown.map((role) => (
                <Tag key={role.id} color={ROLE_COLORS[role.role_code] ?? 'blue'} style={{ marginInlineEnd: 0 }}>
                  {role.role_name}
                </Tag>
              ))}
              {rest.length > 0 && (
                <Tooltip title={rest.map((role) => role.role_name).join('、')}>
                  <Tag color="default" style={{ marginInlineEnd: 0 }}>
                    +{rest.length}
                  </Tag>
                </Tooltip>
              )}
            </Space>
          );
        },
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (status: AccountStatus) => {
          const meta = STATUS_META[status];
          return <Tag color={meta.color}>{meta.label}</Tag>;
        },
      },
      {
        title: '最近登录',
        dataIndex: 'last_login_at',
        width: 150,
        render: (value: string | null) => (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatTime(value)}
          </Typography.Text>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: 232,
        fixed: 'right',
        render: (_, record) => {
          const self = isSelf(record);
          const canDisable = record.status === 'active' && !self;
          const canEnable = record.status === 'disabled' || record.status === 'pending';
          const isLocked = record.status === 'locked';
          const isDisabled = record.status === 'disabled';
          const toggleText = self ? (
            <Tooltip title="不能停用当前登录账号">
              <span>停用</span>
            </Tooltip>
          ) : null;
          return (
            <PermGate code="organization:user:manage">
              <Space size={2} style={{ gap: 0 }}>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
                编辑
              </Button>
              <Button
                type="link"
                size="small"
                icon={<KeyOutlined />}
                disabled={isDisabled}
                onClick={() => openReset(record)}
              >
                重置密码
              </Button>
              {canDisable ? (
                <Popconfirm
                  title={`停用账号「${record.real_name}」？`}
                  description="停用后该账号将立即无法登录，且其登录会话会失效。"
                  okText="停用"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleStatusChange(record, 'disabled', '停用')}
                >
                  <Button type="link" size="small" danger>
                    停用
                  </Button>
                </Popconfirm>
              ) : canEnable ? (
                <Button
                  type="link"
                  size="small"
                  icon={<UnlockOutlined />}
                  onClick={() => void handleStatusChange(record, 'active', '启用')}
                >
                  启用
                </Button>
              ) : isLocked ? (
                <Button
                  type="link"
                  size="small"
                  icon={<UnlockOutlined />}
                  onClick={() => void handleStatusChange(record, 'active', '解锁')}
                >
                  解锁
                </Button>
              ) : (
                toggleText && (
                  <Tooltip title="不能停用当前登录账号">
                    <Button type="link" size="small" danger disabled>
                      停用
                    </Button>
                  </Tooltip>
                )
              )}
              {self ? (
                <Tooltip title="不能删除当前登录账号">
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled>
                    删除
                  </Button>
                </Tooltip>
              ) : (
                <Popconfirm
                  title={`删除账号「${record.real_name}」？`}
                  description="删除后该账号将无法登录，其会话即时失效；操作不可恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleDelete(record)}
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              )}
              </Space>
            </PermGate>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, rows.length, page],
  );

  const departmentFilterOptions = options.departments.map((dept) => ({
    value: dept.id,
    label: dept.department_name,
  }));
  const roleFilterOptions = options.roles.map((role) => ({
    value: role.role_code,
    label: role.role_name,
  }));

  const createdColumns: ColumnsType<AccountImportCreated> = [
    {
      title: '登录账号',
      dataIndex: 'username',
      width: 150,
      render: (username: string) => (
        <Typography.Text style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>
          {username}
        </Typography.Text>
      ),
    },
    { title: '姓名', dataIndex: 'real_name', ellipsis: true },
    {
      title: '初始密码',
      dataIndex: 'password',
      render: (password: string) => (
        <Space size={2}>
          <Typography.Text code style={{ fontSize: 12 }}>
            {password}
          </Typography.Text>
          <Tooltip title="复制密码">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => void handleCopy(password, '密码')}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const createLoading = drawerMode === 'create';

  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title="账号管理"
        subtitle="管理院内平台登录账号，配置科室归属与角色授权，支持启用停用、锁定解锁与密码重置"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <PermGate code="organization:user:manage">
              <Button icon={<ImportOutlined />} onClick={openImport}>
                批量导入
              </Button>
            </PermGate>
            <PermGate code="organization:user:manage">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建账号
              </Button>
            </PermGate>
          </Space>
        }
      />

      <Flex vertical gap={16} style={{ width: '100%' }}>
        {/* 筛选区 */}
        <Card styles={{ body: { padding: 14 } }}>
          <Flex gap={10} wrap align="center">
            <Input.Search
              placeholder="搜索账号 / 姓名 / 工号"
              allowClear
              style={{ width: 230 }}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onSearch={handleSearch}
            />
            <Select
              placeholder="全部状态"
              allowClear
              style={{ width: 130 }}
              value={filters.status || undefined}
              onChange={(value) => applyFilters({ status: (value as AccountStatus) ?? '' })}
              options={Object.entries(STATUS_META).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
            />
            <Select
              placeholder="全部角色"
              allowClear
              style={{ width: 150 }}
              loading={optionsLoading}
              value={filters.roleCode || undefined}
              onChange={(value) => applyFilters({ roleCode: value ?? '' })}
              options={roleFilterOptions}
            />
            <Select
              placeholder="全部科室"
              allowClear
              showSearch={{ optionFilterProp: 'label' }}
              style={{ width: 180 }}
              loading={optionsLoading}
              value={filters.departmentId}
              onChange={(value) => applyFilters({ departmentId: value ?? undefined })}
              options={departmentFilterOptions}
            />
            <Button type="text" onClick={handleResetFilters}>
              重置
            </Button>
            <Typography.Text type="secondary" style={{ marginInlineStart: 'auto', fontSize: 12 }}>
              共 {total} 个账号
            </Typography.Text>
          </Flex>
        </Card>

        {/* 列表 */}
        <Card styles={{ body: { padding: '4px 0 0' } }}>
          <Table<AccountItem>
            rowKey="id"
            size="medium"
            loading={loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1120 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={loading ? '正在加载' : '暂无符合条件的账号，点击「新建账号」开始创建'}
                />
              ),
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (count, range) => `${range[0]}-${range[1]} / 共 ${count} 个`,
              onChange: (nextPage, nextSize) => {
                if (nextSize !== pageSize) setPageSize(nextSize);
                setPage(nextSize !== pageSize ? 1 : nextPage);
              },
            }}
          />
        </Card>
      </Flex>

      {/* 新建 / 编辑抽屉 */}
      <Drawer
        title={drawerMode === 'create' ? '新建账号' : `编辑账号 · ${editing?.real_name ?? ''}`}
        open={drawerOpen}
        onClose={closeDrawer}
        size={540}
        destroyOnHidden
        footer={
          <Flex justify="flex-end" gap={8}>
            <Button onClick={closeDrawer}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
              保存
            </Button>
          </Flex>
        }
      >
        <Form<FormValues> form={form} layout="vertical" preserve={false}>
          {createLoading && (
            <Form.Item
              name="username"
              label="登录账号"
              rules={[
                { required: true, message: '请输入登录账号' },
                { pattern: /^[A-Za-z0-9_.\-]+$/, message: '仅支持字母、数字、下划线、点与短横线' },
                { min: 2, max: 64, message: '长度需为 2-64 个字符' },
              ]}
            >
              <Input placeholder="如 zhangsan" autoFocus />
            </Form.Item>
          )}
          <Form.Item
            name="real_name"
            label="姓名"
            rules={[{ required: true, message: '请输入真实姓名' }]}
          >
            <Input placeholder="账号持有人的真实姓名" maxLength={64} />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="employee_no" label="工号" style={{ flex: 1 }}>
              <Input placeholder="医院工号，可留空" maxLength={64} allowClear />
            </Form.Item>
            <Form.Item name="gender" label="性别" style={{ flex: 1 }}>
              <Select placeholder="选择性别" options={GENDER_OPTIONS} />
            </Form.Item>
          </Flex>
          <Form.Item name="professional_title" label="职称 / 岗位">
            <Input placeholder="如 主治医师 / 责任护士" maxLength={64} allowClear />
          </Form.Item>
          <Form.Item name="department_id" label="所属科室" extra="用于区分业务归属，可稍后调整">
            <Select
              placeholder="选择科室"
              showSearch={{ optionFilterProp: 'label' }}
              allowClear
              loading={optionsLoading}
              options={departmentFilterOptions}
            />
          </Form.Item>
          <Form.Item name="role_ids" label="角色" rules={[{ required: true, message: '请至少选择一个角色' }]}>
            <Select
              mode="multiple"
              placeholder="选择该账号拥有的角色（可多选）"
              loading={optionsLoading}
              optionLabelProp="label"
              options={roleOptions}
              optionRender={(option) => (
                <div>
                  <Typography.Text strong>{option.data.label}</Typography.Text>
                  {option.data.description && (
                    <Typography.Text
                      type="secondary"
                      style={{ display: 'block', fontSize: 12, lineHeight: '18px' }}
                    >
                      {option.data.description}
                    </Typography.Text>
                  )}
                </div>
              )}
              tagRender={({ label, onClose }) => {
                const role = roleOptions.find((item) => item.label === label);
                const code = role?.roleCode ?? '';
                return (
                  <Tag
                    color={ROLE_COLORS[code] ?? 'blue'}
                    closable
                    onClose={(event) => {
                      event.stopPropagation();
                      onClose();
                    }}
                  >
                    {label}
                  </Tag>
                );
              }}
            />
          </Form.Item>
          {createLoading && (
            <>
              <Form.Item
                name="password"
                label="初始密码"
                extra="留空则由系统自动生成 12 位随机密码；该账号首次登录将强制修改密码。"
              >
                <Input.Password
                  placeholder="留空自动生成"
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Form.Item>
              <Form.Item name="status" label="账号状态" tooltip="待启用账号无法登录，需管理员启用后方可使用">
                <Radio.Group
                  options={[
                    { value: 'active', label: '启用（可立即登录）' },
                    { value: 'pending', label: '待启用' },
                  ]}
                />
              </Form.Item>
            </>
          )}
          {!createLoading && (
            <Form.Item label="登录账号">
              <Input value={editing?.username ?? ''} disabled />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                账号名创建后不可修改
              </Typography.Text>
            </Form.Item>
          )}
        </Form>
      </Drawer>

      {/* 创建成功：一次性密码 */}
      <Modal
        title="账号创建成功"
        open={Boolean(createdAccount)}
        onCancel={() => setCreatedAccount(null)}
        footer={
          <Button type="primary" onClick={() => setCreatedAccount(null)}>
            知道了
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          title="请立即保存初始密码"
          description="初始密码仅展示这一次，关闭后将无法再次查看。请及时转交给对应人员，并提醒其登录后修改密码。"
          style={{ marginBottom: 16 }}
        />
        <Flex vertical gap={8}>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              登录账号
            </Typography.Text>
            <Input readOnly value={createdAccount?.username ?? ''} suffix={<UserOutlined />} />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              初始密码
            </Typography.Text>
            <Input
              readOnly
              value={createdAccount?.password ?? ''}
              prefix={<KeyOutlined />}
              suffix={
                <Tooltip title="复制密码">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => void handleCopy(createdAccount?.password ?? '', '初始密码')}
                  />
                </Tooltip>
              }
            />
          </div>
        </Flex>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={`重置密码 · ${resetTarget?.real_name ?? ''}`}
        open={Boolean(resetTarget)}
        onCancel={() => setResetTarget(null)}
        width={520}
        footer={
          <Space>
            <Button
              disabled={Boolean(resetDone) || Boolean(resetDraft.trim())}
              onClick={() => {
                // 自动生成密码会直接完成重置，结果以弹层展示避免误操作
                void handleResetSubmit(true);
              }}
            >
              自动生成
            </Button>
            {resetDone ? (
              <Button
                type="primary"
                onClick={() => {
                  setResetTarget(null);
                }}
              >
                完成
              </Button>
            ) : (
              <Button
                type="primary"
                loading={resetSubmitting}
                onClick={() => void handleResetSubmit(false)}
              >
                重置并保存
              </Button>
            )}
          </Space>
        }
      >
        {resetDone ? (
          <div>
            <Alert
              type="warning"
              showIcon
              title="新密码已生效，仅展示这一次"
              description="该账号已要求下次登录时修改密码，请及时转告账号持有人。"
              style={{ marginBottom: 16 }}
            />
            <Input
              readOnly
              value={resetDone}
              prefix={<KeyOutlined />}
              suffix={
                <Tooltip title="复制新密码">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => void handleCopy(resetDone, '新密码')}
                  />
                </Tooltip>
              }
            />
          </div>
        ) : (
          <Form layout="vertical">
            <Form.Item
              label="新密码"
              extra="重置后该账号现有登录会话将全部失效，需使用新密码重新登录。"
              rules={[{ min: 8, max: 128, message: '密码长度需为 8-128 位' }]}
            >
              <Input.Password
                placeholder="输入新密码（8-128 位），或点击右下「自动生成」"
                maxLength={128}
                autoComplete="new-password"
                value={resetDraft}
                onChange={(event) => setResetDraft(event.target.value)}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 批量导入 */}
      <Modal
        title="批量导入账号"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        width={640}
        footer={
          importResult ? (
            <Space>
              <Button
                onClick={() => {
                  setImportResult(null);
                  setImportText('');
                }}
              >
                继续导入
              </Button>
              <Button type="primary" onClick={() => setImportOpen(false)}>
                完成
              </Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setImportOpen(false)}>取消</Button>
              <Button
                type="primary"
                loading={importing}
                disabled={!importText.trim()}
                onClick={() => void handleImport()}
              >
                开始导入
              </Button>
            </Space>
          )
        }
      >
        {importResult ? (
          <Flex vertical gap={12}>
            <Alert
              type="success"
              showIcon
              title={`成功创建 ${importResult.created} 个账号`}
              description={
                importResult.failed.length
                  ? `以下 ${importResult.failed.length} 行未导入，可按提示修正后重新粘贴导入。`
                  : '全部导入成功。'
              }
            />
            {importResult.accounts.length > 0 && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  title="初始密码仅本次展示，请立即转交对应人员并提醒其登录后修改密码"
                />
                <Table<AccountImportCreated>
                  rowKey="username"
                  size="small"
                  columns={createdColumns}
                  dataSource={importResult.accounts}
                  pagination={false}
                  scroll={{ y: 220 }}
                />
              </>
            )}
            {importResult.failed.length > 0 && (
              <Card size="small" title={`未导入行（${importResult.failed.length}）`} styles={{ body: { padding: 8 } }}>
                <Flex vertical gap={4}>
                  {importResult.failed.map((item) => (
                    <Typography.Text key={`${item.line}-${item.reason}`} style={{ fontSize: 12 }}>
                      <Typography.Text code style={{ fontSize: 12 }}>
                        第 {item.line} 行
                      </Typography.Text>
                      <span style={{ marginInlineStart: 8 }}>{item.reason}</span>
                    </Typography.Text>
                  ))}
                </Flex>
              </Card>
            )}
          </Flex>
        ) : (
          <>
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              每行一条，格式{' '}
              <Typography.Text code style={{ fontSize: 13 }}>
                账号,姓名[,科室编码,角色编码,初始密码]
              </Typography.Text>
              ；科室与角色缺省时可不填，角色缺省为「医生」，密码留空自动生成（8-128 位）。空行与{' '}
              <code>#</code> 开头行自动跳过，重复账号行会跳过并在下方提示。
            </Typography.Paragraph>
            <Input.TextArea
              rows={10}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'zhangsan,张三,cardiology,doctor,Zhang@1234\nlisi,李四,,auditor,\nwangwu,王五'}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
