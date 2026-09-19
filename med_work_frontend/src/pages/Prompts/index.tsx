/**
 * 提示词管理页：管理 AI 聊天的内置助手与个人提示词（Skill）模板。
 * 卡片网格 + 详情抽屉，与 Assistant 内的管理弹窗共用 PromptManagePanel。
 */
import { Card } from 'antd';
import { PageHead, PromptManagePanel } from '@/components';
import { colors } from '@/theme';

export default function Prompts() {
  return (
    <div style={{ padding: 20, height: '100%', overflowY: 'auto', background: colors.bgSecondary }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageHead
          crumbs={[{ label: '智能诊疗中心' }, { label: '提示词管理', current: true }]}
          title="提示词管理"
          subtitle="维护 AI 聊天可用的内置助手与个人提示词，新建会话时在输入区工具栏选用"
        />
        <Card className="panel">
          <PromptManagePanel modalWidth={680} />
        </Card>
      </div>
    </div>
  );
}
