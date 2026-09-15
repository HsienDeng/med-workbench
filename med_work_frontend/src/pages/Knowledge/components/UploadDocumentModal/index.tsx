import { useState } from 'react';
import { Modal, Form, Upload, Input, Select, App as AntApp } from 'antd';
import type { UploadFile } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useDictionaryOptions } from '@/hooks';
import { useKnowledgeStore } from '@/stores/knowledge';
import { DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS } from '@/constants/dictionary';
import type { KnowledgeDocument } from '@/types';

interface UploadDocumentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (doc?: KnowledgeDocument) => void;
}

const SOURCE_OPTIONS = [
  { label: '内部上传', value: '内部上传' },
  { label: '卫健委下发', value: '卫健委下发' },
  { label: '药企资料', value: '药企资料' },
  { label: '科室整理', value: '科室整理' },
  { label: '外部文献', value: '外部文献' },
];

const SUB_TYPE_OPTIONS = [
  '心血管',
  '内分泌',
  '呼吸',
  '消化',
  '神经内科',
  '儿科',
  '妇产',
  '肿瘤',
  '感染',
  '肾病',
  '骨科',
  '其他',
];

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

export default function UploadDocumentModal({ open, onClose, onSuccess }: UploadDocumentModalProps) {
  const { message } = AntApp.useApp();
  const { uploadDocument } = useKnowledgeStore();
  const [form] = Form.useForm();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const { options: docTypeOptions } = useDictionaryOptions(DICT_DOC_TYPE, FALLBACK_DOC_TYPE_OPTIONS);

  const handleOk = async () => {
    const values = await form.validateFields();
    const raw = values.file?.[0] as UploadFile | undefined;
    const file = (raw?.originFileObj ?? raw) as File | undefined;
    if (!file) {
      message.warning('请选择要上传的文档');
      return;
    }
    const title = (values.title || stripExt(file.name)) as string;

    setConfirmLoading(true);
    try {
      const doc = await uploadDocument({
        file,
        title,
        doc_type: values.docType,
        sub_type: values.subType,
        source: values.source ?? '内部上传',
        remark: values.remark,
      });
      onSuccess(doc);
      message.success(`「${title}」已提交，正在后台解析与向量化，列表将自动刷新进度`);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败，请稍后重试');
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <Modal
      title="上传文档"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={confirmLoading}
      okText="开始上传"
      cancelText="取消"
      width={520}
      destroyOnHidden
      afterClose={() => form.resetFields()}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        initialValues={{ docType: 'guide', source: '内部上传' }}
        style={{ marginTop: 12 }}
      >
        <Form.Item
          name="file"
          label="文档文件"
          valuePropName="fileList"
          getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}
          rules={[{ required: true, message: '请选择要上传的文档' }]}
          extra="上传后系统将自动切分文本并生成向量索引，单个文件不超过 50MB"
        >
          <Upload.Dragger
            accept=".pdf,.docx,.txt,.md"
            beforeUpload={() => false}
            maxCount={1}
            onChange={(info) => {
              const f = info.fileList?.[0];
              if (f && !form.getFieldValue('title')) {
                form.setFieldValue('title', stripExt(f.name));
              }
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
            <p className="ant-upload-hint">支持 PDF / Word（docx）/ TXT / Markdown，单个文件</p>
          </Upload.Dragger>
        </Form.Item>

        <Form.Item name="title" label="文档标题" rules={[{ required: true, message: '请输入文档标题' }]}>
          <Input placeholder="默认取文件名（去后缀）" allowClear />
        </Form.Item>

        <Form.Item name="docType" label="文档类型" rules={[{ required: true }]}>
          <Select options={docTypeOptions} />
        </Form.Item>

        <Form.Item name="subType" label="子分类（专科）">
          <Select
            options={SUB_TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
            showSearch
            mode="tags"
            maxCount={1}
            placeholder="选填，如：心血管、内分泌"
          />
        </Form.Item>

        <Form.Item name="source" label="文档来源">
          <Select options={SOURCE_OPTIONS} allowClear placeholder="选填，如：内部上传" />
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={3} placeholder="选填，补充文档来源或说明" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
