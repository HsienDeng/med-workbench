import { useEffect } from 'react';
import { Card, Empty, Flex, Progress, Tag, Typography } from 'antd';
import { KpiCard } from '@/components';
import { colors } from '@/theme';
import { useKnowledgeStore } from '@/stores/knowledge';

/** 卡片头：标题 + 副标题（antd 组合） */
function CardHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Flex vertical gap={3}>
      <Typography.Text strong style={{ fontSize: 15 }}>
        {title}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {subtitle}
      </Typography.Text>
    </Flex>
  );
}

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 文档管理「概览」：KPI + 文档构成 + 知识质量看板（知识库总览并入文档管理） */
export default function DocOverview() {
  const { overview, loadOverview } = useKnowledgeStore();

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const o = overview;
  const totalDocs = o?.total_documents ?? 0;
  const ratio = totalDocs > 0 ? Math.round(((o?.ready_documents ?? 0) / totalDocs) * 1000) / 10 : 0;
  const typeTotal = o?.doc_type_distribution?.reduce((s, d) => s + d.count, 0) ?? 0;

  const kpis = [
    {
      label: '文档总数',
      value: String(totalDocs),
      unit: '篇',
      desc: `占用 ${formatBytes(o?.total_size_bytes ?? 0)}`,
      icon: 'docs',
      iconColor: 'blue',
    },
    {
      label: '已索引',
      value: String(o?.ready_documents ?? 0),
      unit: '篇',
      desc: `索引覆盖率 ${ratio}%`,
      icon: 'valid',
      iconColor: 'green',
    },
    {
      label: '处理中',
      value: String(o?.parsing_documents ?? 0),
      unit: '篇',
      desc: '等待向量化完成',
      icon: 'update',
      iconColor: 'orange',
    },
    {
      label: '索引失败',
      value: String(o?.failed_documents ?? 0),
      unit: '篇',
      desc: '需检查后重试',
      icon: 'review',
      iconColor: 'purple',
    },
  ];

  return (
    <>
      <div className="kpi-grid">
        {kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
        {/* 文档构成 */}
        <Card
          title={<CardHead title="文档构成" subtitle="各类型文档占比" />}
          styles={{ body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1, minHeight: 0 } }}
        >
          {(o?.doc_type_distribution ?? []).map((d) => {
            const p = typeTotal > 0 ? Math.round((d.count / typeTotal) * 1000) / 10 : 0;
            return (
              <div key={d.doc_type}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}
                >
                  <span className="text-secondary">{d.label}</span>
                  <strong>
                    {d.count} 篇 <span className="text-muted" style={{ fontWeight: 400 }}>· {p}%</span>
                  </strong>
                </div>
                <Progress
                  percent={p}
                  showInfo={false}
                  strokeColor={{ '0%': colors.primary, '100%': colors.ai }}
                  trailColor="#EEF1F6"
                  size="small"
                />
              </div>
            );
          })}
          {(o?.doc_type_distribution ?? []).length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无文档，可在「本地知识库」中上传"
            />
          )}
          <div
            style={{
              marginTop: 'auto',
              padding: 12,
              background: colors.bgSecondary,
              borderRadius: 8,
              fontSize: 12,
              color: colors.textMuted,
            }}
          >
            索引规模：<strong className="text-secondary">{totalDocs} 篇</strong> · 文本分块{' '}
            <strong className="text-secondary">{o?.total_chunks ?? 0}</strong> · 向量{' '}
            <strong className="text-secondary">{o?.total_vectors ?? 0}</strong>
          </div>
        </Card>

        {/* 知识质量看板 */}
        <Card
          title={<CardHead title="知识质量看板" subtitle="知识库健康度指标" />}
          extra={
            <Tag
              color={ratio === 100 ? 'success' : ratio > 0 ? 'blue' : 'warning'}
              style={{ marginRight: 0 }}
            >
              {ratio}% 已索引
            </Tag>
          }
          styles={{ body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 } }}
        >
          {[
            {
              label: '向量索引覆盖率',
              value: `${ratio}%`,
              ratio,
              color: 'ai',
            },
            {
              label: '处理中文档',
              value: `${o?.parsing_documents ?? 0} 篇`,
              ratio: totalDocs > 0 ? Math.round(((o?.parsing_documents ?? 0) / totalDocs) * 1000) / 10 : 0,
              color: 'warning',
            },
            {
              label: '索引失败文档',
              value: `${o?.failed_documents ?? 0} 篇`,
              ratio: totalDocs > 0 ? Math.round(((o?.failed_documents ?? 0) / totalDocs) * 1000) / 10 : 0,
              color: 'error',
            },
          ].map((q) => (
            <div key={q.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span className="text-secondary">{q.label}</span>
                <strong>{q.value}</strong>
              </div>
              <Progress
                percent={q.ratio}
                showInfo={false}
                strokeColor={q.color === 'ai' ? colors.ai : q.color === 'error' ? colors.error : colors.warning}
                trailColor="#EEF1F6"
                size="small"
              />
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
