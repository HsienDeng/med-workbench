import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Input,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { PageHead } from '@/components';
import { colors } from '@/theme';
import { getAuditLogs, getAuditOptions } from '@/services/audit';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_MODULE_LABELS,
  AUDIT_RESULT_LABELS,
  type AuditLogItem,
} from '@/types';

const { RangePicker } = DatePicker;

/** 模块 Tag 颜色 */
const MODULE_COLOR: Record<string, string> = {
  auth: 'geekblue',
  patient: 'blue',
  medical_record: 'cyan',
  analysis: 'purple',
};

/** 操作 Tag 颜色 */
const ACTION_COLOR: Record<string, string> = {
  login: 'geekblue',
  logout: 'default',
  register: 'cyan',
  view: 'blue',
  create: 'green',
  update: 'orange',
  delete: 'red',
  parse: 'purple',
};

/** 结果 Tag 颜色 */
const RESULT_COLOR: Record<string, string> = {
  success: 'green',
  failure: 'red',
  denied: 'orange',
};

/** 资源类型中文名 */
const RESOURCE_LABELS: Record<string, string> = {
  patient: '患者档案',
  medical_record: '病历记录',
  analysis_record: '分析记录',
};

/** ISO 时间 → 本地展示串 */
function formatTime(iso: string): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 19);
}

function toOptions(codes: string[], labels: Record<string, string>) {
  return codes.map((code) => ({ value: code, label: labels[code] ?? code }));
}

export default function Audit() {
  const { message } = AntApp.useApp();

  // ---------- 筛选选项（后端兜底为主，异常时回退本地常量） ----------
  const [modules, setModules] = useState<string[]>(Object.keys(AUDIT_MODULE_LABELS));
  const [actions, setActions] = useState<string[]>(Object.keys(AUDIT_ACTION_LABELS));

  // ---------- 筛选条件 ----------
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  useEffect(() => {
    getAuditOptions()
      .then((res) => {
        if (res.modules.length) setModules(res.modules);
        if (res.actions.length) setActions(res.actions);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAuditLogs({
        page,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
        module: module || undefined,
        action: action || undefined,
        result: result || undefined,
        start_date: range?.[0]?.format('YYYY-MM-DD'),
        end_date: range?.[1]?.format('YYYY-MM-DD'),
      });
      setRows(res.items);
      setTotal(res.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, module, result, action, range, message]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo<ColumnsType<AuditLogItem>>(
    () => [
      {
        title: '时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 165,
        render: (v: string) => (
          <span className="mono" style={{ fontSize: 12, color: colors.textSecondary }}>
            {formatTime(v)}
          </span>
        ),
      },
      {
        title: '操作者',
        key: 'actor',
        width: 150,
        render: (_: unknown, r: AuditLogItem) => (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {r.real_name || r.username || '—'}
            </div>
            {r.username && r.username !== r.real_name && (
              <div className="text-muted" style={{ fontSize: 11 }}>
                @{r.username}
              </div>
            )}
          </div>
        ),
      },
      {
        title: '模块',
        dataIndex: 'module',
        key: 'module',
        width: 110,
        render: (v: string) => (
          <Tag color={MODULE_COLOR[v] ?? 'default'} style={{ marginInlineEnd: 0 }}>
            {AUDIT_MODULE_LABELS[v] ?? v}
          </Tag>
        ),
      },
      {
        title: '操作',
        dataIndex: 'action',
        key: 'action',
        width: 100,
        render: (v: string) => (
          <Tag color={ACTION_COLOR[v] ?? 'default'} style={{ marginInlineEnd: 0 }}>
            {AUDIT_ACTION_LABELS[v] ?? v}
          </Tag>
        ),
      },
      {
        title: '资源',
        key: 'resource',
        width: 170,
        render: (_: unknown, r: AuditLogItem) => {
          if (!r.resource_type && !r.resource_id) return <span className="text-muted">—</span>;
          return (
            <span className="mono" style={{ fontSize: 12 }}>
              {r.resource_id
                ? `${RESOURCE_LABELS[r.resource_type ?? ''] ?? r.resource_type ?? ''} ${r.resource_id}`
                : r.resource_type}
            </span>
          );
        },
      },
      {
        title: '摘要',
        dataIndex: 'detail',
        key: 'detail',
        ellipsis: true,
        render: (v: string | null) =>
          v ? (
            <Tooltip title={v}>
              <span style={{ fontSize: 13 }}>{v}</span>
            </Tooltip>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        title: '结果',
        dataIndex: 'result',
        key: 'result',
        width: 80,
        render: (v: string) => (
          <Tag color={RESULT_COLOR[v] ?? 'default'} style={{ marginInlineEnd: 0 }}>
            {AUDIT_RESULT_LABELS[v] ?? v}
          </Tag>
        ),
      },
      {
        title: '来源 IP',
        dataIndex: 'ip',
        key: 'ip',
        width: 135,
        render: (v: string | null) => (
          <span className="mono" style={{ fontSize: 12 }}>
            {v || '—'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title="审计日志"
        subtitle="记录登录、患者档案 / 病历 / AI 分析等关键操作的完整轨迹（仅管理员与审计员可见）"
      />

      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '16px 20px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Input
            prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
            placeholder="搜索账号 / 姓名 / 摘要"
            allowClear
            style={{ width: 240 }}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
          <Select
            placeholder="全部模块"
            style={{ width: 140 }}
            allowClear
            value={module || undefined}
            onChange={(v) => {
              setModule(v ?? '');
              setPage(1);
            }}
            options={toOptions(modules, AUDIT_MODULE_LABELS)}
          />
          <Select
            placeholder="全部操作"
            style={{ width: 130 }}
            allowClear
            value={action || undefined}
            onChange={(v) => {
              setAction(v ?? '');
              setPage(1);
            }}
            options={toOptions(actions, AUDIT_ACTION_LABELS)}
          />
          <Select
            placeholder="全部结果"
            style={{ width: 120 }}
            allowClear
            value={result || undefined}
            onChange={(v) => {
              setResult(v ?? '');
              setPage(1);
            }}
            options={[
              { value: 'success', label: '成功' },
              { value: 'failure', label: '失败' },
              { value: 'denied', label: '拒绝' },
            ]}
          />
          <RangePicker
            value={range ?? undefined}
            onChange={(values) => {
              setRange(values && values[0] && values[1] ? [values[0], values[1]] : null);
              setPage(1);
            }}
            placeholder={['开始日期', '结束日期']}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load()}>
            刷新
          </Button>
        </div>
        <Table<AuditLogItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1080 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => (
              <span className="text-muted" style={{ fontSize: 12 }}>
                共 {t} 条记录
              </span>
            ),
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>
    </div>
  );
}
