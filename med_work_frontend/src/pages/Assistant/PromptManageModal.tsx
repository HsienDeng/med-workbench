/**
 * 提示词管理弹窗：Assistant 输入区内的快捷管理入口。
 * 内容为共享组件 PromptManagePanel，与「提示词管理」页面同源。
 */
import { Modal } from 'antd';
import { PromptManagePanel } from '@/components';
import type { PromptTemplate } from '@/services/prompts';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 增删改后回调（通知父级刷新下拉选项） */
  onChanged: (prompts: PromptTemplate[]) => void;
}

export default function PromptManageModal({ open, onClose, onChanged }: Props) {
  return (
    <Modal
      title="提示词管理"
      open={open}
      onCancel={onClose}
      width={760}
      footer={null}
      destroyOnHidden
      className="prompt-manage-modal"
    >
      <PromptManagePanel onChanged={onChanged} />
    </Modal>
  );
}
