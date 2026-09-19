import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageHead from '@/components/PageHead';
import PermGate from '@/components/PermGate';
import {
  createRole,
  deleteRole,
  getRole,
  getRoleMenuTree,
  getRolePermissionTree,
  getRoles,
  setRoleStatus,
  updateRole,
} from '@/services/roles';
import type {
  DataScopeCode,
  RoleDetailItem,
  RoleItem,
  RoleMenuTreeNode,
  RolePermissionTreeNode,
  RoleStatus,
} from '@/types';

/** 角色状态 → 文案与 Tag 颜色 */
const STATUS_META: Record<RoleStatus, { label: string; color: string }> = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '已停用', color: 'default' },
};

/** 数据范围 → 文案、Tag 颜色与说明 */
const DATA_SCOPE_META: Record<DataScopeCode, { label: string; description: string; color: string }> = {
  self: { label: '仅本人数据', description: '只能查看本人负责的数据（范围最小，默认）', color: 'default' },
  department: { label: '本科室数据', description: '可查看本科室范围内的数据', color: 'blue' },
  department_tree: { label: '科室及下级科室', description: '可查看本科室及其下级科室的数据', color: 'cyan' },
  hospital: { label: '全院数据', description: '可查看全院数据（范围最大，请谨慎授权）', color: 'purple' },
};

/** 系统内置角色 → Tag 颜色 */
const ROLE_COLORS: Record<string, string> = {
  hospital_admin: 'volcano',
  doctor: 'geekblue',
  knowledge_admin: 'cyan',
  auditor: 'purple',
};

const DATA_SCOPE_ORDER: DataScopeCode[] = ['self', 'department', 'department_tree', 'hospital'];
const EMPTY_TEXT = '—';

function formatTime(iso: string | null): string {
  if (!iso) return EMPTY_TEXT;
  return iso.replace('T', ' ').slice(0, 16);
}

interface FilterState {
  keyword: string;
  status: RoleStatus | '';
}

interface FormValues {
  role_code?: string;
  role_name?: string;
  data_scope?: DataScopeCode;
  status?: RoleStatus;
  description?: string;
}

type DrawerMode = 'create' | 'edit' | null;

/** 菜单授权树节点（title 为纯文本，可直接作为 Tree data） */
interface MenuTreeData {
  key: string;
  title: string;
  children?: MenuTreeData[];
}

/** 权限点授权树节点（叶子展示权限说明，父节点为模块分组） */
interface PermissionTreeData {
  key: string;
  title: ReactNode;
  selectable?: boolean;
  children?: PermissionTreeData[];
}

function collectParentKeys(tree: RoleMenuTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (nodes: RoleMenuTreeNode[] | undefined) => {
    (nodes ?? []).forEach((node) => {
      if (node.children?.length) {
        keys.push(node.key);
        walk(node.children);
      }
    });
  };
  walk(tree);
  return keys;
}

export default function Permissions() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();

  // ---------- 列表与筛选 ----------
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RoleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<FilterState>({ keyword: '', status: '' });

  // ---------- 菜单授权树 ----------
  const [menuTree, setMenuTree] = useState<RoleMenuTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  // ---------- 功能权限点授权树 ----------
  const [permissionTree, setPermissionTree] = useState<RolePermissionTreeNode[]>([]);
  const [permTreeLoading, setPermTreeLoading] = useState(false);

  // ---------- 新建 / 编辑 ----------
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkedMenuKeys, setCheckedMenuKeys] = useState<string[]>([]);
  const [checkedPermissionKeys, setCheckedPermissionKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [expandedPermKeys, setExpandedPermKeys] = useState<string[]>([]);

  const isSystemEditing = editing?.is_system === true;
  /** 树只读场景：系统内置角色或详情仍在加载 */
  const treeReadonly = isSystemEditing || detailLoading;

  const treeData = useMemo<MenuTreeData[]>(() => {
    const map = (nodes: RoleMenuTreeNode[]): MenuTreeData[] =>
      nodes.map((node) => ({
        key: node.key,
        title: node.title,
        children: node.children?.length ? map(node.children) : undefined,
      }));
    return map(menuTree);
  }, [menuTree]);

  const permissionTreeData = useMemo<PermissionTreeData[]>(() => {
    const map = (nodes: RolePermissionTreeNode[]): PermissionTreeData[] =>
      nodes.map((node) => ({
        key: node.key,
        selectable: node.selectable,
        title: node.description ? (
          <Tooltip title={node.description}>
            <span>{node.title}</span>
          </Tooltip>
        ) : (
          node.title
        ),
        children: node.children?.length ? map(node.children) : undefined,
      }));
    return map(permissionTree);
  }, [permissionTree]);

  // ---------- 列表加载 ----------
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRoles({
        page,
        page_size: pageSize,
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
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

  const loadMenuTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const { items } = await getRoleMenuTree();
      setMenuTree(items);
      setExpandedKeys(collectParentKeys(items));
    } catch {
      // 请求层已提示
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMenuTree();
  }, [loadMenuTree]);

  const loadPermissionTree = useCallback(async () => {
    setPermTreeLoading(true);
    try {
      const { items } = await getRolePermissionTree();
      setPermissionTree(items);
      setExpandedPermKeys(items.map((node) => node.key));
    } catch {
      // 请求层已提示
    } finally {
      setPermTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPermissionTree();
  }, [loadPermissionTree]);

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
    setFilters({ keyword: '', status: '' });
  };

  // ---------- 新建 / 编辑 ----------
  const closeDrawer = () => {
    if (submitting) return;
    setDrawerOpen(false);
    setDrawerMode(null);
    setEditing(null);
  };

  const openCreate = () => {
    setEditing(null);
    setDrawerMode('create');
    setCheckedMenuKeys([]);
    setCheckedPermissionKeys([]);
    form.resetFields();
    form.setFieldsValue({ data_scope: 'self', status: 'active', description: '' });
    setDrawerOpen(true);
  };

  const openEdit = (item: RoleItem) => {
    setEditing(item);
    setDrawerMode('edit');
    setCheckedMenuKeys([]);
    setCheckedPermissionKeys([]);
    form.resetFields();
    setDrawerOpen(true);
    setDetailLoading(true);
    getRole(item.id)
      .then((detail) => {
        form.setFieldsValue({
          role_name: detail.role_name,
          data_scope: detail.data_scope as DataScopeCode,
          status: detail.status,
          description: detail.description ?? '',
        });
        setCheckedMenuKeys(detail.menu_keys);
        setCheckedPermissionKeys(detail.permission_keys ?? []);
      })
      .catch(() => {
        // 请求层已提示；加载失败则关闭抽屉避免在空数据上误保存
        setDrawerOpen(false);
        setDrawerMode(null);
        setEditing(null);
      })
      .finally(() => setDetailLoading(false));
  };

  const handleSubmit = async () => {
    if (!form) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (drawerMode === 'create') {
        const result = await createRole({
          role_code: (values.role_code ?? '').trim(),
          role_name: (values.role_name ?? '').trim(),
          description: values.description?.trim() || null,
          data_scope: values.data_scope ?? 'self',
          status: values.status ?? 'active',
          menu_keys: checkedMenuKeys,
          permission_keys: checkedPermissionKeys,
        });
        message.success(`角色「${result.role_name}」已创建`);
      } else if (editing) {
        const description = values.description?.trim() || null;
        if (isSystemEditing) {
          // 系统内置角色仅允许修改说明，其余字段由系统统一维护
          await updateRole(editing.id, { description });
          message.success('角色说明已更新');
        } else {
          await updateRole(editing.id, {
            role_name: (values.role_name ?? '').trim(),
            description,
            data_scope: values.data_scope ?? 'self',
            status: values.status ?? 'active',
            menu_keys: checkedMenuKeys,
            permission_keys: checkedPermissionKeys,
          });
          message.success(`角色「${editing.role_name}」已更新`);
        }
      }
      setDrawerOpen(false);
      setDrawerMode(null);
      setEditing(null);
      void load();
    } catch {
      // 请求层已提示（编码重复 / 名称重复等）
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- 启停 / 删除 ----------
  const handleToggleStatus = async (item: RoleItem, status: RoleStatus, actionText: string) => {
    try {
      await setRoleStatus(item.id, status);
      message.success(`角色「${item.role_name}」已${actionText}`);
      void load();
    } catch {
      // 请求层已提示
    }
  };

  const handleDelete = async (item: RoleItem) => {
    try {
      await deleteRole(item.id);
      message.success(`角色「${item.role_name}」已删除`);
      void load();
    } catch {
      // 请求层已提示（仍有成员时后端拒绝）
    }
  };

  // ---------- 表格列 ----------
  const columns: ColumnsType<RoleItem> = useMemo(
    () => [
      {
        title: '角色名称',
        dataIndex: 'role_name',
        width: 210,
        render: (name: string, record) => (
          <Space size={6}>
            <Typography.Text strong>{name}</Typography.Text>
            {record.is_system && (
              <Tooltip title="系统内置角色，编码 / 授权范围由系统统一维护">
                <Tag color={ROLE_COLORS[record.role_code] ?? 'gold'} style={{ marginInlineEnd: 0 }}>
                  系统内置
                </Tag>
              </Tooltip>
            )}
          </Space>
        ),
      },
      {
        title: '角色编码',
        dataIndex: 'role_code',
        width: 160,
        render: (code: string) => (
          <Typography.Text style={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>
            {code}
          </Typography.Text>
        ),
      },
      {
        title: '数据范围',
        dataIndex: 'data_scope',
        width: 170,
        render: (scope: string) => {
          const meta = DATA_SCOPE_META[scope as DataScopeCode];
          if (!meta) return scope || EMPTY_TEXT;
          return (
            <Tooltip title={meta.description}>
              <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                {meta.label}
              </Tag>
            </Tooltip>
          );
        },
      },
      {
        title: '成员数',
        dataIndex: 'member_count',
        width: 90,
        align: 'center' as const,
        render: (count: number) => (count > 0 ? count : EMPTY_TEXT),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
        render: (status: RoleStatus) => (
          <Tag color={STATUS_META[status]?.color ?? 'default'} style={{ marginInlineEnd: 0 }}>
            {STATUS_META[status]?.label ?? status}
          </Tag>
        ),
      },
      {
        title: '更新时间',
        dataIndex: 'updated_at',
        width: 150,
        render: (value: string | null) => formatTime(value),
      },
      {
        title: '操作',
        key: 'actions',
        width: 200,
        fixed: 'right' as const,
        render: (_, record) => {
          const disabledNow = record.status === 'disabled';
          return (
            <PermGate
              code="organization:role:manage"
              fallback={
                <Button type="link" size="small" icon={<EditOutlined />} disabled>
                  编辑
                </Button>
              }
            >
            <Space size={4}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(record)}
              >
                编辑
              </Button>
              {record.is_system ? (
                <Tooltip title="系统内置角色不能停用，权限由系统统一管理">
                  <Button type="link" size="small" icon={<LockOutlined />} disabled>
                    停用
                  </Button>
                </Tooltip>
              ) : disabledNow ? (
                <Button
                  type="link"
                  size="small"
                  icon={<UnlockOutlined />}
                  onClick={() => void handleToggleStatus(record, 'active', '启用')}
                >
                  启用
                </Button>
              ) : (
                <Popconfirm
                  title={`停用角色「${record.role_name}」？`}
                  description="停用后该角色所有成员的权限即时失效；重新启用角色可恢复其成员的授权。"
                  okText="停用"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleToggleStatus(record, 'disabled', '停用')}
                >
                  <Button type="link" size="small" icon={<LockOutlined />} danger>
                    停用
                  </Button>
                </Popconfirm>
              )}
              {record.is_system ? (
                <Tooltip title="系统内置角色不可删除">
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled>
                    删除
                  </Button>
                </Tooltip>
              ) : (
                <Popconfirm
                  title={`删除角色「${record.role_name}」？`}
                  description="删除后角色定义将被移除，不可恢复；仍有成员时无法删除。"
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
    [rows.length, page],
  );

  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title="权限管理"
        subtitle="配置院内角色可访问的功能菜单、可操作的功能权限点，并通过数据范围控制账号的数据可见边界"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <PermGate code="organization:role:manage">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建角色
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
              placeholder="搜索角色名称 / 编码"
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
              onChange={(value) => applyFilters({ status: (value as RoleStatus | '') ?? '' })}
              options={Object.entries(STATUS_META).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
            />
            <Button type="text" onClick={handleResetFilters}>
              重置
            </Button>
            <Typography.Text type="secondary" style={{ marginInlineStart: 'auto', fontSize: 12 }}>
              共 {total} 个角色
            </Typography.Text>
          </Flex>
        </Card>

        {/* 列表 */}
        <Card styles={{ body: { padding: '4px 0 0' } }}>
          <Table<RoleItem>
            rowKey="id"
            size="medium"
            loading={loading}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1080 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={loading ? '正在加载' : '暂无符合条件的角色，点击右上角「新建角色」开始配置'}
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
        title={drawerMode === 'create' ? '新建角色' : `编辑角色 · ${editing?.role_name ?? ''}`}
        open={drawerOpen}
        onClose={closeDrawer}
        size={680}
        destroyOnHidden={false}
        loading={detailLoading}
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={closeDrawer} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
              {drawerMode === 'create' ? '创建角色' : '保存'}
            </Button>
          </Space>
        }
      >
        {isSystemEditing && (
          <Alert
            type="info"
            showIcon
            title="系统内置角色"
            description="系统内置角色的编码、数据范围、状态、菜单与功能权限点授权由系统统一维护，这里仅可修改角色说明。"
            style={{ marginBottom: 16 }}
          />
        )}

        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="role_code"
            label="角色编码"
            rules={[
              { required: true, message: '请输入角色编码' },
              {
                pattern: /^[a-z][a-z0-9_]{1,63}$/,
                message: '小写字母开头，仅含小写字母 / 数字 / 下划线',
              },
            ]}
          >
            <Input
              placeholder="如 chief_nurse"
              maxLength={64}
              disabled={drawerMode === 'edit'}
              prefix={
                drawerMode === 'edit' ? (
                  <Tooltip title="角色编码创建后不可修改">
                    <SafetyCertificateOutlined />
                  </Tooltip>
                ) : undefined
              }
            />
          </Form.Item>
          <Form.Item
            name="role_name"
            label="角色名称"
            rules={[{ required: true, whitespace: true, message: '请输入角色名称' }]}
          >
            <Input
              placeholder="如 护士长"
              maxLength={64}
              disabled={isSystemEditing}
              count={{ show: true, max: 64 }}
            />
          </Form.Item>
          <Form.Item
            name="data_scope"
            label="数据范围"
            extra="数据范围决定该角色账号能查看的数据边界，请结合岗位职责谨慎授权。"
          >
            <Select<DataScopeCode>
              disabled={isSystemEditing}
              options={DATA_SCOPE_ORDER.map((value) => ({
                value,
                label: DATA_SCOPE_META[value].label,
              }))}
            />
          </Form.Item>
          {!isSystemEditing && (
            <Form.Item name="status" label="角色状态">
              <Radio.Group
                options={[
                  { value: 'active', label: '启用' },
                  { value: 'disabled', label: '停用' },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="description" label="角色说明">
            <Input.TextArea
              rows={2}
              maxLength={255}
              placeholder="说明该角色的职责、适用范围等（可选）"
              showCount
            />
          </Form.Item>
        </Form>

        {/* 菜单授权 */}
        <Card
          size="small"
          title={
            <Space size={6}>
              <Typography.Text strong>菜单授权</Typography.Text>
              {isSystemEditing && (
                <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                  系统统一维护
                </Tag>
              )}
            </Space>
          }
          extra={
            !treeReadonly && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已勾选 {checkedMenuKeys.length} 项
              </Typography.Text>
            )
          }
          styles={{ body: { maxHeight: 320, overflow: 'auto' } }}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            {isSystemEditing
              ? '系统内置角色的授权范围由系统统一管理，不可修改。'
              : '勾选该角色登录后可访问的功能菜单，未勾选的页面将不展示。'}
          </Typography.Paragraph>
          {treeLoading ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="菜单加载中" />
          ) : (
            <Tree
              checkable
              selectable={false}
              blockNode
              treeData={treeData}
              checkedKeys={checkedMenuKeys}
              expandedKeys={expandedKeys}
              disabled={treeReadonly}
              onExpand={(keys) => setExpandedKeys(keys.map(String))}
              onCheck={(checked) => {
                const keys = Array.isArray(checked)
                  ? (checked as string[])
                  : (checked.checked as string[]);
                setCheckedMenuKeys(keys);
              }}
            />
          )}
        </Card>

        {/* 功能权限点授权 */}
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={
            <Space size={6}>
              <Typography.Text strong>功能权限点授权</Typography.Text>
              {isSystemEditing && (
                <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                  系统统一维护
                </Tag>
              )}
            </Space>
          }
          extra={
            !treeReadonly && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已勾选 {checkedPermissionKeys.length} 项
              </Typography.Text>
            )
          }
          styles={{ body: { maxHeight: 320, overflow: 'auto' } }}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            {isSystemEditing
              ? '系统内置角色的权限点授权由系统统一管理，不可修改。'
              : '权限点决定页面内的按钮与操作（如新建患者、发起 AI 分析、删除文档），未勾选的操作前端自动隐藏，后端同样拦截。'}
          </Typography.Paragraph>
          {permTreeLoading ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="权限点加载中" />
          ) : (
            <Tree
              checkable
              selectable={false}
              blockNode
              treeData={permissionTreeData}
              checkedKeys={checkedPermissionKeys}
              expandedKeys={expandedPermKeys}
              disabled={treeReadonly}
              onExpand={(keys) => setExpandedPermKeys(keys.map(String))}
              onCheck={(checked) => {
                const keys = Array.isArray(checked)
                  ? (checked as string[])
                  : (checked.checked as string[]);
                setCheckedPermissionKeys(keys);
              }}
            />
          )}
        </Card>
      </Drawer>
    </div>
  );
}
