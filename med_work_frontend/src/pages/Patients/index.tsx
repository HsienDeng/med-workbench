import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { PageHead } from '@/components';
import PermGate from '@/components/PermGate';
import { colors } from '@/theme';
import { useDictionaryOptions } from '@/hooks';
import {
  DICT_DEPT,
  DICT_PATIENT_STATUS,
  FALLBACK_DEPT_OPTIONS,
  FALLBACK_PATIENT_STATUS_OPTIONS,
} from '@/constants/dictionary';
import { createPatient, deletePatient, getPatients, updatePatient } from '@/services/patients';
import type { PatientItem, PatientPayload } from '@/types';
import PatientDetailView from './PatientDetailView';
import ReportExportModal from './components/ReportExportModal';

/** 患者状态 → Tag 颜色 */
const STATUS_COLOR: Record<string, string> = {
  in: 'blue',
  out: 'default',
  transfer: 'orange',
};

const GENDER_LABEL: Record<string, string> = {
  male: '男',
  female: '女',
};

/** ISO 时间 → 本地展示串（避免额外引入 dayjs） */
function formatTime(iso: string): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 16);
}

/** BMI = 体重(kg) / 身高(m)^2，保留 1 位小数 */
function calcBMI(height?: number | null, weight?: number | null): number | null {
  if (height && weight && height > 0) {
    return Math.round((weight / ((height / 100) ** 2)) * 10) / 10;
  }
  return null;
}

export default function Patients() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<Omit<PatientPayload, 'birth_date'> & { birth_date?: Dayjs | null }>();

  // ---------- 字典（科室 / 状态由字典维护） ----------
  const { options: deptOptions, labels: deptLabels } = useDictionaryOptions(DICT_DEPT, FALLBACK_DEPT_OPTIONS);
  const { options: statusOptions, labels: statusLabels } = useDictionaryOptions(
    DICT_PATIENT_STATUS,
    FALLBACK_PATIENT_STATUS_OPTIONS,
  );

  // ---------- 列表 ----------
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PatientItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  /** 勾选的患者（用于批量导出报告） */
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // ---------- 新建 / 编辑 ----------
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PatientItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ---------- 详情整页 ----------
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPatients({
        page,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
        dept: dept || undefined,
        status: status || undefined,
      });
      setRows(res.items);
      setTotal(res.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载患者列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, dept, status, message]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- 报告导出（勾选患者后批量导出 Word） ----------
  const [exportOpen, setExportOpen] = useState(false);

  // ---------- 新建 / 编辑 ----------
  const openCreate = useCallback(() => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ gender: 'male', age: 0, status: 'in' });
    setModalOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (item: PatientItem) => {
      setEditing(item);
      form.setFieldsValue({
        name: item.name,
        gender: item.gender || 'male',
        age: item.age,
        birth_date: item.birth_date ? dayjs(item.birth_date) : undefined,
        allergy_history: item.allergy_history ?? undefined,
        past_history: item.past_history ?? undefined,
        height: item.height ?? undefined,
        weight: item.weight ?? undefined,
        waistline: item.waistline ?? undefined,
        phone: item.phone ?? '',
        primary_diag: item.primary_diag,
        dept: item.dept,
        status: item.status,
      });
      setModalOpen(true);
    },
    [form],
  );

  const handleSubmit = useCallback(async () => {
    const raw = await form.validateFields();
    const values: PatientPayload = {
      ...raw,
      birth_date: raw.birth_date ? dayjs(raw.birth_date).format('YYYY-MM-DD') : null,
      allergy_history: (raw.allergy_history || '').trim() || null,
      past_history: (raw.past_history || '').trim() || null,
    };
    setSubmitting(true);
    try {
      if (editing) {
        await updatePatient(editing.id, values);
        message.success('患者信息已更新');
      } else {
        await createPatient(values);
        message.success('患者档案已创建');
      }
      setModalOpen(false);
      load();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setSubmitting(false);
    }
  }, [form, editing, load, message]);

  const handleDelete = useCallback(
    async (item: PatientItem) => {
      try {
        await deletePatient(item.id);
        message.success('已删除');
        load();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '删除失败');
      }
    },
    [load, message],
  );

  // ---------- 表格 ----------
  const columns = useMemo<ColumnsType<PatientItem>>(
    () => [
      {
        title: '患者编号',
        dataIndex: 'patient_no',
        key: 'patient_no',
        width: 170,
        render: (v: string) => (
          <span className="mono" style={{ color: colors.primary, fontWeight: 600 }}>
            {v}
          </span>
        ),
      },
      {
        title: '患者',
        key: 'name',
        ellipsis: true,
        width: 170,
        render: (_: unknown, r: PatientItem) => (
          <Space>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background:
                  r.gender === 'female'
                    ? `linear-gradient(135deg, ${colors.purple}, #C084FC)`
                    : `linear-gradient(135deg, ${colors.primary}, ${colors.ai})`,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {r.name[0]}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                {GENDER_LABEL[r.gender] ?? (r.gender || '未知')} · {r.age} 岁
              </div>
            </div>
          </Space>
        ),
      },
      {
        title: '科室',
        dataIndex: 'dept',
        key: 'dept',
        width: 130,
        render: (v: string) => <span style={{ fontSize: 13 }}>{deptLabels[v] ?? '—'}</span>,
      },
      {
        title: '主诊断',
        dataIndex: 'primary_diag',
        key: 'primary_diag',
        ellipsis: true,
        width: 400,
        render: (v: string) => <span style={{ fontSize: 13 }}>{v || '—'}</span>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (v: string) => (
          <Tag color={STATUS_COLOR[v] ?? 'default'} style={{ marginInlineEnd: 0 }}>
            {statusLabels[v] ?? v}
          </Tag>
        ),
      },
      {
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 150,
        render: (v: string) => (
          <span className="mono" style={{ fontSize: 12, color: colors.textSecondary }}>
            {formatTime(v)}
          </span>
        ),
      },
      {
        title: '',
        key: 'action',
        align: 'right',
        render: (_: unknown, r: PatientItem) => (
          <Space size={4}>
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetailId(r.id)}>
              详情
            </Button>
            <PermGate code="patient:update">
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                编辑
              </Button>
            </PermGate>
            <PermGate code="patient:delete">
              <Popconfirm
                title="删除患者档案"
                description={`确定删除「${r.name}」吗？删除后不可恢复。`}
                okText="删除"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDelete(r)}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </PermGate>
          </Space>
        ),
      },
    ],
    [deptLabels, statusLabels, openEdit, handleDelete],
  );

  // ---------- BMI 自动预览 ----------
  const h = Form.useWatch('height', form);
  const w = Form.useWatch('weight', form);
  const bmiPreview = calcBMI(h, w);

  // ---------- 整页详情 ----------
  if (detailId != null) {
    return <PatientDetailView patientId={detailId} onBack={() => setDetailId(null)} />;
  }

  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title="患者档案"
        subtitle="患者基本资料与病例分析归属管理"
        actions={
          <>
            <PermGate code="patient:export">
              <Button
                icon={<DownloadOutlined />}
                onClick={() => {
                  if (!selectedIds.length) {
                    message.info('请先勾选要导出报告的患者');
                    return;
                  }
                  setExportOpen(true);
                }}
              >
                导出报告{selectedIds.length ? `（${selectedIds.length}）` : ''}
              </Button>
            </PermGate>
            <PermGate code="patient:create">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建患者
              </Button>
            </PermGate>
          </>
        }
      />

      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '16px 20px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Input
            prefix={<SearchOutlined style={{ color: colors.textMuted }} />}
            placeholder="搜索姓名 / 手机号 / 主诊断"
            allowClear
            style={{ width: 260 }}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
          <Select
            placeholder="全部科室"
            style={{ width: 150 }}
            allowClear
            value={dept || undefined}
            onChange={(v) => {
              setDept(v ?? '');
              setPage(1);
            }}
            options={deptOptions}
          />
          <Select
            placeholder="全部状态"
            style={{ width: 130 }}
            allowClear
            value={status || undefined}
            onChange={(v) => {
              setStatus(v ?? '');
              setPage(1);
            }}
            options={statusOptions}
          />
        </div>
        <Table<PatientItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as number[]),
          }}
          scroll={{ x: 940 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            showTotal: (t) => (
              <span className="text-muted" style={{ fontSize: 12 }}>
                共 {t} 位患者
              </span>
            ),
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      {/* 导出患者诊疗分析报告（Word） */}
      <ReportExportModal
        open={exportOpen}
        candidates={rows
          .filter((r) => selectedIds.includes(r.id))
          .map((r) => ({ id: r.id, name: r.name, patient_no: r.patient_no }))}
        defaultIds={selectedIds}
        onClose={() => setExportOpen(false)}
      />

      {/* 新建 / 编辑 */}
      <Modal
        title={editing ? '编辑患者' : '新建患者'}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={submitting}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入患者姓名" maxLength={64} />
          </Form.Item>
          <Form.Item name="gender" label="性别" rules={[{ required: true, message: '请选择性别' }]}>
            <Radio.Group>
              <Radio.Button value="male">男</Radio.Button>
              <Radio.Button value="female">女</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="age" label="年龄" rules={[{ required: true, message: '请输入年龄' }]} style={{ flex: 1 }}>
              <InputNumber min={0} max={200} style={{ width: '100%' }} placeholder="岁" />
            </Form.Item>
            <Form.Item name="birth_date" label="出生日期" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
            <Form.Item name="height" label="身高（cm）" style={{ flex: 1 }}>
              <InputNumber min={0} max={250} precision={1} style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
          </Flex>
          <Flex gap={12}>
            <Form.Item name="weight" label="体重（kg）" style={{ flex: 1 }}>
              <InputNumber min={0} max={500} precision={1} style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
            <Form.Item label="BMI（自动计算）" style={{ flex: 1 }}>
              <Input value={bmiPreview ? String(bmiPreview) : ''} placeholder="填身高体重后自动计算" disabled />
            </Form.Item>
            <Form.Item name="waistline" label="腰围（cm）" style={{ flex: 1 }}>
              <InputNumber min={0} max={300} precision={1} style={{ width: '100%' }} placeholder="选填" />
            </Form.Item>
          </Flex>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="选填" maxLength={32} />
          </Form.Item>
          <Form.Item name="allergy_history" label="过敏史">
            <Input.TextArea rows={2} placeholder="档案层常驻过敏史，选填（与单次病历的过敏史区分）" maxLength={2000} />
          </Form.Item>
          <Form.Item name="past_history" label="既往史">
            <Input.TextArea rows={3} placeholder="既往高血压 / 糖尿病 / 手术史等，选填（常驻档案）" maxLength={4000} />
          </Form.Item>
          <Form.Item
            name="primary_diag"
            label="主诊断"
            rules={[{ required: true, message: '请输入主诊断' }]}
          >
            <Input.TextArea rows={2} placeholder="请输入主诊断" maxLength={512} />
          </Form.Item>
          <Form.Item name="dept" label="科室" rules={[{ required: true, message: '请选择科室' }]}>
            <Select placeholder="请选择科室" options={deptOptions} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select placeholder="请选择状态" options={statusOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
