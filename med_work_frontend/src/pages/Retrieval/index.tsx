import { useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { ExperimentOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { colors } from '@/theme';
import { searchKnowledgeApi, downloadDocumentFile } from '@/services/knowledge';
import type { SearchHit } from '@/types';

const DOC_TYPE_LABELS: Record<string, string> = {
  guide: '临床指南',
  literature: '医学文献',
  drug: '药品说明书',
  case: '疑难病例',
  norm: '院内规范',
  other: '其他',
};

const LIMIT_OPTIONS = [5, 10, 20, 30];

/** 检索测试：语义检索可视化验证（问题 → 命中列表/片段/分数） */
export default function Retrieval() {
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState<SearchHit | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    try {
      const resp = await searchKnowledgeApi(q, limit);
      setHits(resp.hits ?? []);
      setSearched(resp.query ?? q);
    } catch {
      // 错误提示已由 api.ts 全局处理
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (hit: SearchHit) => {
    setDownloading(true);
    try {
      await downloadDocumentFile(hit.document_id, `${hit.title.replace(/[《》]/g, '')}.pdf`);
      message.success(`已开始下载「${hit.title}」`);
    } catch {
      // 错误提示已由 api.ts 全局处理
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto', background: colors.bgSecondary }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <Card
          className="panel"
          styles={{ header: { borderBottom: `1px solid ${colors.border}` } }}
          title={
            <Space>
              <span className="tile-icon-sm" style={{ background: colors.primaryLight, color: colors.primary }}>
                <ExperimentOutlined />
              </span>
              检索测试
            </Space>
          }
        >
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={() => void handleSearch()}
              placeholder="输入临床问题或关键词，如：阿司匹林肠溶片一次吃多少"
              size="large"
              allowClear
            />
            <Select
              value={limit}
              onChange={setLimit}
              options={LIMIT_OPTIONS.map((v) => ({ value: v, label: `Top ${v}` }))}
              style={{ width: 100 }}
              size="large"
            />
            <Button
              type="primary"
              size="large"
              icon={<SearchOutlined />}
              loading={loading}
              onClick={() => void handleSearch()}
            >
              检索
            </Button>
          </Space.Compact>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            基于 bge 向量 + Qdrant 的语义检索；可在「文档管理」上传指南/说明书/规范等文档后测试命中效果。
          </Typography.Text>
        </Card>

        {searched ? (
          <Card
            className="panel"
            style={{ marginTop: 16 }}
            styles={{ header: { borderBottom: `1px solid ${colors.border}` } }}
            title={`「${searched}」命中 ${hits.length} 条`}
          >
            {hits.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未检索到相关内容，可尝试更换关键词或确认文档已索引完成" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {hits.map((hit, i) => (
                  <div
                    key={`${hit.document_id}-${i}`}
                    onClick={() => setActive(hit)}
                    style={{
                      border: `1px solid ${colors.border}`,
                      borderRadius: 10,
                      padding: '12px 14px',
                      background: i === 0 ? colors.primaryLight : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Tag color="default" style={{ marginInlineEnd: 0 }}>#{i + 1}</Tag>
                      <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                        {DOC_TYPE_LABELS[hit.doc_type] ?? hit.doc_type}
                      </Tag>
                      <span
                        style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}
                      >
                        {hit.title}
                      </span>
                      <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                        {Math.round((hit.score || 0) * 100)}%
                      </Tag>
                    </div>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: '8px 0 0', fontSize: 13 }}
                      ellipsis={{ rows: 3, expandable: false }}
                    >
                      {hit.content}
                    </Typography.Paragraph>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>

      <Drawer
        title={active?.title}
        open={active !== null}
        width={520}
        onClose={() => setActive(null)}
        extra={
          active ? (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloading}
              onClick={() => void handleDownload(active)}
            >
              查看原文
            </Button>
          ) : null
        }
      >
        {active ? (
          <>
            <Space style={{ marginBottom: 12 }}>
              <Tag color="blue">{DOC_TYPE_LABELS[active.doc_type] ?? active.doc_type}</Tag>
              <Tag color="purple">相关度 {Math.round((active.score || 0) * 100)}%</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{active.file_name}</Typography.Text>
            </Space>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
              {active.content}
            </Typography.Paragraph>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
