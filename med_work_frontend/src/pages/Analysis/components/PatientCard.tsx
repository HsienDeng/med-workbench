import type { ReactNode } from 'react';
import { Card, Space, Tag } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { colors } from '@/theme';
import type { MedicalRecordItem, PatientItem } from '@/types';

interface PatientCardProps {
  patient: PatientItem | null;
  record: MedicalRecordItem | null;
}

const GENDER_LABEL: Record<string, string> = {
  male: '男',
  female: '女',
};

function formatDate(iso?: string): string {
  return iso ? iso.slice(0, 10) : '-';
}

/** 患者信息卡片（真实患者 + 病历数据） */
export default function PatientCard({ patient, record }: PatientCardProps) {
  if (!patient) return null;

  const gender = GENDER_LABEL[patient.gender] ?? patient.gender ?? '';
  const chiefComplaint = record?.chief_complaint?.trim() || patient.primary_diag || '-';
  const statusText = patient.status === 'in' ? '在院' : patient.status === 'out' ? '已出院' : patient.status;
  const inStatus = patient.status === 'in';
  const height = patient.height != null ? `${patient.height} cm` : '-';
  const weight = patient.weight != null ? `${patient.weight} kg` : '-';
  const bmi = patient.bmi != null ? patient.bmi.toFixed(1) : '-';

  const cell = (label: string, value: ReactNode, span2 = false) => (
    <div
      style={{
        gridColumn: span2 ? '1 / -1' : undefined,
        minWidth: 0,
        padding: '7px 10px',
        borderRadius: 8,
        background: colors.bgSecondary,
        border: `1px solid ${colors.border}`,
      }}
    >
      <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{value}</div>
    </div>
  );

  return (
    <Card
      className="panel"
      styles={{ header: { borderBottom: `1px solid ${colors.border}` } }}
      title={
        <Space>
          <span className="tile-icon-sm" style={{ background: colors.primaryLight, color: colors.primary }}>
            <UserOutlined />
          </span>
          患者信息
        </Space>
      }
      extra={<span className="text-muted" style={{ fontSize: 12 }}>{patient.patient_no}</span>}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: `linear-gradient(135deg, ${colors.primary}, ${colors.purple})`,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {patient.name?.[0] ?? '患'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            {patient.name}
            <Tag color={inStatus ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
              {statusText}
            </Tag>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>
            {gender} · {patient.age ?? '-'} 岁 · {patient.dept || '未分配科室'}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '9px 12px',
          background: colors.bgSecondary,
          borderRadius: 10,
          border: `1px solid ${colors.border}`,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>主诉</div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{chiefComplaint}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {cell('主诊断', patient.primary_diag || '-', true)}
        {cell('病历记录', record ? `#${record.id} · ${formatDate(record.created_at)}` : '未选择')}
        {cell('入院科室', patient.dept || '-')}
        {cell('身高', height)}
        {cell('体重', weight)}
        {cell('BMI', bmi)}
        {cell('联系电话', patient.phone || '-')}
      </div>
    </Card>
  );
}
