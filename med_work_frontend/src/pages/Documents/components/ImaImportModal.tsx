/**
 * IMA 文档同步确认弹窗（两步式导入的第一步）。
 * 只登记一条「未索引」记录，不下载正文；第二步在上传任务中点「开始索引」：
 * IMA 取回全文 → 本地切分 → bge 向量化 → Qdrant。
 */
import { useEffect, useState } from 'react';
import { Alert, Modal, Select, Typography } from 'antd';
import { App as AntApp } from 'antd';
import { useDictionaryOptions } from '@/hooks';
import { importImaMediaApi } from '@/services/knowledge';
import { DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS } from '@/constants/dictionary';

export interface ImaImportItem {
  media_id: string;
  title?: string | null;
}

interface ImaImportModalProps {
  item: ImaImportItem | null;
  onClose: () => void;
}

export default function ImaImportModal({ item, onClose }: ImaImportModalProps) {
  const { message } = AntApp.useApp();
  const [docType, setDocType] = useState('guide');
  const [submitting, setSubmitting] = useState(false);
  const { options: docTypeOptions } = useDictionaryOptions(DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS);

  useEffect(() => {
    if (item) setDocType('guide');
  }, [item]);

  const handleOk = async () => {
    if (!item) return;
    setSubmitting(true);
    try {
      const res = await importImaMediaApi({
        mediaId: item.media_id,
        title: item.title || undefined,
        doc_type: docType,
      });
      if (!res.submitted) {
        message.warning(res.error || 'IMA 服务未配置或暂不可用');
        onClose();
        return;
      }
      message.success('已加入上传任务，请在「上传任务」中点击该条目的「开始索引」');
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="同步到本地知识库"
      open={Boolean(item)}
      onOk={() => void handleOk()}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="开始同步"
      cancelText="取消"
      width={480}
      destroyOnHidden
    >
      {item && (
        <div style={{ marginTop: 8 }}>
          <Typography.Paragraph style={{ marginBottom: 12 }}>
            <span className="text-muted">文档：</span>
            <strong>{item.title || '（无标题）'}</strong>
          </Typography.Paragraph>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6, fontSize: 13 }}>保存为本地文档类型</div>
            <Select
              style={{ width: '100%' }}
              value={docType}
              onChange={setDocType}
              options={docTypeOptions}
            />
          </div>
          <Alert
            type="info"
            showIcon
            title={
              <span>
                同步后先登记为「未索引」，需您在「上传任务」中点击
                <strong> 开始索引 </strong>
                ，系统才会取回 IMA 全文并向量化入库。
              </span>
            }
          />
        </div>
      )}
    </Modal>
  );
}
