import { Button, Card, Result } from 'antd';
import { ClockCircleOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { PageHead } from '@/components';
import type { PageKey } from '@/types';

const PAGE_TITLES: Record<string, { title: string; desc: string }> = {
  entities: { title: '医疗实体', desc: '基于医学实体识别模型，对临床病历中的药品、诊断、症状、检验指标等进行自动抽取与归一化管理，支持实体库构建、关系发现与标准化映射。' },
  retrieval: { title: '检索测试', desc: '面向 RAG 管线的混合检索（向量 + BM25）测试台，支持 Query 调试、TopK 与重排序参数调节、召回到相关度评估。' },
  accounts: { title: '账号管理', desc: '管理平台用户账号，支持账号增删改查、科室归属、启停锁定、密码重置与批量导入。' },
  permissions: { title: '权限管理', desc: '基于 RBAC 的权限模型，配置角色、菜单授权、功能权限点与数据范围策略。' },
};

export default function Phase2Placeholder({
  page,
  onNavigate,
}: {
  page: PageKey;
  onNavigate: (k: PageKey) => void;
}) {
  const info = PAGE_TITLES[page] ?? { title: page, desc: '模块建设中' };
  return (
    <div className="workbench-page">
      <PageHead
        crumbs={[]}
        title={info.title}
        actions={
          <Button onClick={() => onNavigate('dashboard')}>
            <ArrowLeftOutlined /> 返回工作台
          </Button>
        }
      />
      <Card style={{ maxWidth: 640, margin: '32px auto', borderRadius: 16, boxShadow: '0 8px 24px rgba(27,37,55,0.06)' }}>
        <Result
          icon={<ClockCircleOutlined style={{ color: '#8B5CF6' }} />}
          title={`${info.title} · 二期建设中`}
          subTitle={
            <>
              {info.desc}
              <br />
              该模块将在二期开放，敬请期待
            </>
          }
          extra={
            <Button type="primary" onClick={() => onNavigate('dashboard')}>
              返回工作台
            </Button>
          }
        />
      </Card>
    </div>
  );
}
