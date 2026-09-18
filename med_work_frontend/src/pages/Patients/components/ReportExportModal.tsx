import { useEffect, useState } from 'react';
import { App as AntApp, DatePicker, Modal, Segmented, Select, Space, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { downloadPatientReport } from '@/services/patients';
import type { PatientReportRange, ReportFormat } from '@/types';

const { RangePicker } = DatePicker;

/** 可选患者（列表页传勾选行，详情页传当前患者） */
export interface ReportCandidate {
  id: number;
  name: string;
  patient_no: string;
}

interface ReportExportModalProps {
  open: boolean;
  candidates: ReportCandidate[];
  /** 打开时预选中的患者 ID */
  defaultIds?: number[];
  /** 锁定选择（详情页导出当前患者时无需再选） */
  lockSelection?: boolean;
  onClose: () => void;
}

/**
 * 导出患者诊疗分析报告（Word）。
 * 支持多选患者（逐个下载）与可选时间范围（留空导出全部记录）。
 */
export default function ReportExportModal({
  open,
  candidates,
  defaultIds,
  lockSelection = false,
  onClose,
}: ReportExportModalProps) {
  const { message } = AntApp.useApp();
  const [ids, setIds] = useState<number[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [format, setFormat] = useState<ReportFormat>('docx');
  const [submitting, setSubmitting] = useState(false);

  const defaultKey = (defaultIds ?? []).join(',');
  useEffect(() => {
    if (!open) return;
    setIds(defaultKey ? defaultKey.split(',').map(Number) : []);
    setRange(null);
    setFormat('docx');
  }, [open, defaultKey]);

  const handleOk = async () => {
    if (!ids.length) {
      message.warning('请选择要导出的患者');
      return;
    }
    setSubmitting(true);
    try {
      const payload: PatientReportRange = {
        start_date: range?.[0]?.format('YYYY-MM-DD'),
        end_date: range?.[1]?.format('YYYY-MM-DD'),
      };
      for (const id of ids) {
        // 逐个 await：避免并发触发浏览器的多文件下载拦截
        await downloadPatientReport(id, payload, format);
      }
      message.success(ids.length > 1 ? `已导出 ${ids.length} 份报告` : '报告已开始下载');
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="导出患者诊疗分析报告"
      open={open}
      onOk={handleOk}
      confirmLoading={submitting}
      onCancel={onClose}
      okText={format === 'pdf' ? '导出 PDF' : '导出 Word'}
      cancelText="取消"
      destroyOnHidden
      width={480}
    >
      <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 12 }}>
        <div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>导出格式</div>
          <Segmented
            block
            value={format}
            onChange={(value) => setFormat(value as ReportFormat)}
            options={[
              { value: 'docx', label: 'Word（可编辑再打印）' },
              { value: 'pdf', label: 'PDF（版式固定）' },
            ]}
          />
        </div>
        <div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>选择患者{lockSelection ? '' : '（可多选）'}</div>
          <Select
            style={{ width: '100%' }}
            placeholder="请选择患者"
            disabled={lockSelection}
            showSearch
            optionFilterProp="label"
            mode={lockSelection ? undefined : 'multiple'}
            value={lockSelection ? ids[0] : ids}
            onChange={(value) => setIds(lockSelection ? [value as number] : (value as number[]))}
            options={candidates.map((item) => ({
              value: item.id,
              label: `${item.name}　${item.patient_no}`,
            }))}
          />
        </div>

        <div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>时间范围（可选）</div>
          <RangePicker
            style={{ width: '100%' }}
            value={range}
            onChange={(value) => setRange(value as [Dayjs, Dayjs] | null)}
            placeholder={['开始日期', '结束日期']}
          />
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          报告包含患者基本信息、所选时间范围内的全部病历记录与 AI 分析（结论 / 关注点 /
          循证依据），导出为可编辑的 Word 文档；留空时间范围表示导出全部记录。
        </Typography.Text>
      </Space>
    </Modal>
  );
}
