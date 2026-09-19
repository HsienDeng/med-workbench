import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bubble, Sender } from '@ant-design/x';
import { XMarkdown } from '@ant-design/x-markdown';
import type { GetProp } from 'antd';
import { Button, App as AntApp, Avatar, Popconfirm, Select, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  DeleteOutlined,
  UserOutlined,
  LoadingOutlined,
  FileTextOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  MedicineBoxOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { colors } from '@/theme';
import assistantAvatar from '@/assets/assistant.png';
import {
  streamChat,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
  type ChatMessageInput,
} from '@/services/chat';
import { downloadDocumentFile } from '@/services/knowledge';
import { getPatients } from '@/services/patients';
import { getAiConnections } from '@/services/api';
import type { PatientItem } from '@/types';
import { useXChat, type XAgent, type XMessage } from '@/hooks/useXChat';
import { toPersist } from '@/hooks/chatMessageState';
import './index.css';

interface Conv {
  /** 后端会话 id（String 形式，与后端持久化对应） */
  key: string;
  label: string;
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** 助手消息下方的知识库引用卡片列表（含命中片段与原文下载） */
function CitationList({ citations }: { citations: NonNullable<XMessage['citations']> }) {
  const { message } = AntApp.useApp();
  const [downloading, setDownloading] = useState<number | null>(null);

  const handleDownload = async (docId: number, title: string) => {
    setDownloading(docId);
    try {
      await downloadDocumentFile(docId, `${title.replace(/[《》]/g, '')}.pdf`);
      message.success(`已开始下载「${title}」`);
    } catch {
      // 错误提示已由 api.ts 全局处理
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        知识库引用（{citations.length}）
      </Typography.Text>
      {citations.map((c) => (
        <div
          key={c.document_id}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '8px 10px',
            background: colors.bgSecondary,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileTextOutlined style={{ color: colors.primary, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{c.title}</span>
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              {Math.round((c.score || 0) * 100)}%
            </Tag>
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              style={{ padding: '0 4px' }}
              loading={downloading === c.document_id}
              onClick={() => void handleDownload(c.document_id, c.title)}
            >
              原文
            </Button>
          </div>
          {c.snippet ? (
            <Typography.Paragraph
              type="secondary"
              style={{ margin: '6px 0 0', fontSize: 12 }}
              ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
            >
              {c.snippet}
            </Typography.Paragraph>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const roles: GetProp<typeof Bubble.List, 'role'> = {
  user: { placement: 'end', avatar: <Avatar size={28} icon={<UserOutlined />} style={{ background: colors.primary }} /> },
  assistant: { placement: 'start', avatar: <Avatar size={28} src={assistantAvatar} /> },
};

/** 后端消息（ChatRole 可能含 system）转为页面消息（仅 user / assistant） */
const toXMessage = (m: ChatMessageInput): XMessage => ({
  id: genId(),
  role: m.role === 'user' ? 'user' : 'assistant',
  content: m.content,
  status: m.role === 'assistant' ? 'done' : undefined,
  citations: m.citations ?? undefined,
});

export default function Assistant() {
  const { message } = AntApp.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const handledRequest = useRef<string>();
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [convInitialized, setConvInitialized] = useState(false);
  const [activeKey, setActiveKey] = useState('');
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [loadingConversationKey, setLoadingConversationKey] = useState('');
  const [loadErrorKey, setLoadErrorKey] = useState('');
  const [patients, setPatients] = useState<PatientItem[]>([]);
  const [patientId, setPatientId] = useState<number>();
  const [selectedPatient, setSelectedPatient] = useState<PatientItem>();
  const [patientSearch, setPatientSearch] = useState('');
  const [patientLoading, setPatientLoading] = useState(true);
  const [patientLoadFailed, setPatientLoadFailed] = useState(false);
  const [knowledgeScope, setKnowledgeScope] = useState('local');
  const [taskType, setTaskType] = useState('analysis');
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  const [model, setModel] = useState<string>();
  const [modelLoading, setModelLoading] = useState(true);
  const [modelLoadFailed, setModelLoadFailed] = useState(false);
  const storeRef = useRef<Record<string, XMessage[]>>({});
  const loadVersionRef = useRef(0);
  const saveQueueRef = useRef<Record<string, Promise<unknown>>>({});

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setPatientLoading(true);
      setPatientLoadFailed(false);
      void getPatients({ page_size: 20, keyword: patientSearch.trim() || undefined })
        .then(({ items }) => { if (alive) setPatients(items); })
        .catch(() => { if (alive) setPatientLoadFailed(true); })
        .finally(() => { if (alive) setPatientLoading(false); });
    }, patientSearch ? 250 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [patientSearch]);

  useEffect(() => {
    let alive = true;
    void getAiConnections()
      .then((connections) => {
        if (!alive) return;
        const available = connections.filter((c) => c.enabled && c.has_api_key);
        setModelOptions(available.flatMap((c) => c.models.map((name) => ({
          value: `${c.provider}:${name}`,
          label: `${c.name} · ${name}`,
        }))));
        const active = available.find((c) => c.status === 'connected') ?? available[0];
        if (active) setModel(`${active.provider}:${active.active_model}`);
      })
      .catch(() => { if (alive) setModelLoadFailed(true); })
      .finally(() => { if (alive) setModelLoading(false); });
    return () => { alive = false; };
  }, []);

  // 当前激活会话与列表的引用（供防抖保存闭包读取最新值）
  const activeKeyRef = useRef(activeKey);
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // 自定义 agent：把对话转给后端 /api/chat/stream 流式转发
  const agent = useMemo<XAgent>(
    () => ({
      request: ({ messages }, cb) => {
        streamChat(
          messages.map((m) => ({ role: m.role, content: m.content })),
          {
            signal: cb.signal,
            onChunk: cb.onUpdate,
            onCitations: cb.onCitations,
            onDone: cb.onSuccess,
            onError: cb.onError,
          },
        );
      },
    }),
    [],
  );

  const { messages, onRequest, onCancel, setMessages, loading } = useXChat({ agent });

  // 把当前会话的消息同步进 store，支持多会话切换
  useEffect(() => {
    if (activeKey) storeRef.current[activeKey] = messages;
  }, [messages, activeKey]);

  /** 保存按会话串行执行，避免旧快照晚完成而覆盖新消息。 */
  const saveConversation = useCallback((key: string, snapshot: XMessage[]) => {
    const item = conversationsRef.current.find((conv) => conv.key === key);
    if (!item) return;
    const persisted = toPersist(snapshot);
    if (!persisted.length) return;
    const previous = saveQueueRef.current[key] ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() =>
      updateConversation(Number(key), { title: item.label, messages: persisted }),
    );
    saveQueueRef.current[key] = pending;
    void pending.catch(() => message.warning('对话保存失败，请稍后重试'));
  }, [message]);

  /** 拉取并应用指定会话的消息；旧请求不能覆盖当前视图。 */
  const loadConversation = useCallback(async (convId: number) => {
    const key = String(convId);
    const version = ++loadVersionRef.current;
    setLoadingConversationKey(key);
    setLoadErrorKey('');
    try {
      const detail = await getConversation(convId);
      if (version !== loadVersionRef.current || activeKeyRef.current !== key) return;
      const msgs = detail.messages.map(toXMessage);
      storeRef.current[key] = msgs;
      setMessages(msgs);
    } catch {
      if (version !== loadVersionRef.current || activeKeyRef.current !== key) return;
      setLoadErrorKey(key);
      message.error('会话内容加载失败');
    } finally {
      if (version === loadVersionRef.current) setLoadingConversationKey('');
    }
  }, [setMessages, message]);

  // 挂载：加载会话列表；空则新建一个
  useEffect(() => {
    let alive = true;
    const initialRequest = location.state?.newConversation ? location.key : null;
    if (initialRequest) {
      handledRequest.current = initialRequest;
      navigate('/assistant', { replace: true, state: null });
    }
    (async () => {
      try {
        let list = await listConversations();
        if (!alive) return;
        if (!list.length || initialRequest) {
          const created = await createConversation();
          list = [created, ...list];
        }
        if (!alive) return;
        const items: Conv[] = list.map((c) => ({ key: String(c.id), label: c.title }));
        setConversations(items);
        setActiveKey(items[0].key);
        const detail = await getConversation(list[0].id);
        if (!alive) return;
        storeRef.current[items[0].key] = detail.messages.map(toXMessage);
        if (activeKeyRef.current === items[0].key) setMessages(storeRef.current[items[0].key]);
      } catch {
        if (alive) {
          setLoadErrorKey(activeKeyRef.current || 'initial');
          message.error('对话历史加载失败');
        }
      } finally {
        if (alive) setConvInitialized(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 完整消息变化后防抖保存；切换会话时由操作入口立即保存旧会话。
  useEffect(() => {
    if (!convInitialized || !activeKey || messages.some((item) => item.status === 'loading')) return;
    const key = activeKey;
    const snapshot = messages;
    const timer = window.setTimeout(() => saveConversation(key, snapshot), 800);
    return () => window.clearTimeout(timer);
  }, [messages, convInitialized, activeKey, conversations, saveConversation]);

  const switchActive = (key: string) => {
    if (key === activeKey) return;
    onCancel();
    if (activeKey) saveConversation(activeKey, messages);
    ++loadVersionRef.current;
    setLoadingConversationKey('');
    setLoadErrorKey('');
    setActiveKey(key);
    const cached = storeRef.current[key];
    if (cached) {
      setMessages(cached);
    } else {
      setMessages([]);
      void loadConversation(Number(key));
    }
  };

  const newConversation = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createConversation();
      onCancel();
      if (activeKey) saveConversation(activeKey, messages);
      ++loadVersionRef.current;
      setLoadingConversationKey('');
      setLoadErrorKey('');
      const item: Conv = { key: String(created.id), label: created.title };
      storeRef.current[item.key] = [];
      setConversations((prev) => [item, ...prev]);
      setActiveKey(item.key);
      setMessages([]);
    } catch {
      message.error('新建对话失败');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!convInitialized || !location.state?.newConversation || handledRequest.current === location.key) return;
    handledRequest.current = location.key;
    navigate('/assistant', { replace: true, state: null });
    void newConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convInitialized, location.key]);

  const removeConv = async (key: string) => {
    const convId = Number(key);
    if (key === activeKey) {
      onCancel();
      ++loadVersionRef.current;
      setLoadingConversationKey('');
      setLoadErrorKey('');
    }
    const rest = conversations.filter((c) => c.key !== key);
    delete storeRef.current[key];
    setConversations(rest);

    try {
      await deleteConversation(convId);
    } catch {
      message.warning('删除服务端记录失败');
    }

    if (!rest.length) {
      // 删空后自动新建一个空会话
      try {
        const created = await createConversation();
        const item: Conv = { key: String(created.id), label: created.title };
        storeRef.current[item.key] = [];
        setConversations([item]);
        if (key === activeKey) {
          setActiveKey(item.key);
          setMessages([]);
        }
      } catch {
        message.error('新建对话失败');
      }
      return;
    }
    if (key === activeKey) {
      const first = rest[0];
      setActiveKey(first.key);
      const cached = storeRef.current[first.key];
      if (cached) {
        setMessages(cached);
      } else {
        setMessages([]);
        void loadConversation(Number(first.key));
      }
    }
  };

  const handleSend = (raw: string) => {
    const text = (raw ?? '').trim();
    if (!text || !activeKey || !onRequest(text)) return;
    setInput('');
    if (activeKey) {
      setConversations((prev) =>
        prev.map((c) => (c.key === activeKey && c.label === '新对话' ? { ...c, label: text.slice(0, 14) } : c)),
      );
    }
  };

  const renderContent = (m: XMessage) => {
    if (m.role === 'assistant' && m.status === 'loading' && !m.content) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: colors.textMuted }}>
          <LoadingOutlined /> 正在思考…
        </span>
      );
    }
    if (m.status === 'error') {
      return <span style={{ color: colors.error, whiteSpace: 'pre-wrap' }}>{m.content || '对话出错'}</span>;
    }
    if (m.role === 'user') return <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>;
    return (
      <div>
        {m.content ? (
          <XMarkdown
            content={m.content}
            className="assistant-markdown x-markdown-light"
            escapeRawHtml
            openLinksInNewTab
            streaming={{ hasNextChunk: m.status === 'loading' }}
          />
        ) : null}
        {m.status === 'stopped' ? <span className="assistant-stopped">已停止生成</span> : null}
        {m.citations?.length ? <CitationList citations={m.citations} /> : null}
      </div>
    );
  };

  const items = messages.map((m) => ({ key: m.id, role: m.role, content: renderContent(m) }));
  const isEmpty = messages.length === 0;
  const patientOptions = (selectedPatient && !patients.some((patient) => patient.id === selectedPatient.id)
    ? [selectedPatient, ...patients]
    : patients
  ).map((patient) => ({ value: patient.id, label: `${patient.name} · ${patient.patient_no}` }));

  return (
    <div className="assistant-page">
      <aside className="assistant-sessions" aria-label="会话历史">
        <div className="assistant-sessions-scroll">
          <h2>最近会话</h2>
          {conversations.length ? (
            <ul className="assistant-session-list">
              {conversations.map((conv) => (
                <li key={conv.key} className={`assistant-session-item${activeKey === conv.key ? ' assistant-session-item--active' : ''}`}>
                  <Button
                    type="text"
                    className="assistant-session-switch"
                    title={conv.label}
                    aria-current={activeKey === conv.key ? 'page' : undefined}
                    onClick={() => switchActive(conv.key)}
                  >
                    {conv.label}
                  </Button>
                  <Popconfirm
                    title="删除这段对话？"
                    description="删除后无法恢复"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void removeConv(conv.key)}
                  >
                    <Button type="text" icon={<DeleteOutlined />} title="删除对话" aria-label={`删除对话：${conv.label}`} />
                  </Popconfirm>
                </li>
              ))}
            </ul>
          ) : <p className="assistant-session-empty">{convInitialized ? '暂无历史会话' : '正在加载会话…'}</p>}
        </div>
      </aside>

      <div className="assistant-workspace">
        <div className="assistant-toolbar">
          <span className="assistant-thread-title">{conversations.find((c) => c.key === activeKey)?.label || '新对话'}</span>
        </div>

        <div className={`assistant-main${isEmpty ? ' assistant-main--empty' : ''}`}>
          {loadErrorKey === activeKey || (loadErrorKey === 'initial' && !activeKey) ? (
            <div className="assistant-welcome">
              <p>对话加载失败</p>
              <Button onClick={() => activeKey ? void loadConversation(Number(activeKey)) : window.location.reload()}>重试加载</Button>
            </div>
          ) : loadingConversationKey === activeKey && activeKey ? (
            <div className="assistant-welcome"><LoadingOutlined /> 正在加载对话…</div>
          ) : isEmpty ? (
            <div className="assistant-welcome">
              <div className="assistant-mark" aria-hidden="true"><MedicineBoxOutlined /></div>
              <h1>你想让我在 <span>MedAI 工作台</span> 处理什么？</h1>
            </div>
          ) : (
            <div className="assistant-messages"><Bubble.List autoScroll items={items} role={roles} /></div>
          )}
        </div>

        <div className="assistant-composer">
          <div className="assistant-options">
            <div className="assistant-option-list" role="group" aria-label="预览配置">
              <div className="assistant-option assistant-option--patient">
                <UserOutlined aria-hidden="true" /><span>患者</span>
                <Select<number>
                  aria-label="选择患者（预览配置）"
                  placeholder="未选择"
                  value={patientId}
                  onChange={(value) => {
                    setPatientId(value);
                    setSelectedPatient(patients.find((patient) => patient.id === value));
                    setPatientSearch('');
                  }}
                  onOpenChange={(open) => { if (!open) setPatientSearch(''); }}
                  allowClear
                  showSearch={{ filterOption: false, onSearch: setPatientSearch }}
                  loading={patientLoading}
                  notFoundContent={patientLoadFailed ? '加载失败，请重新搜索' : patientLoading ? '正在搜索…' : '无匹配患者'}
                  options={patientOptions}
                  popupMatchSelectWidth={300}
                  variant="borderless"
                />
              </div>
              <div className="assistant-option">
                <BookOutlined aria-hidden="true" /><span>知识库</span>
                <Select
                  aria-label="知识库范围（预览配置）"
                  value={knowledgeScope}
                  onChange={setKnowledgeScope}
                  options={[
                    { value: 'local', label: '本机构知识库' },
                    { value: 'all', label: '全部可用资料' },
                    { value: 'none', label: '不指定资料' },
                  ]}
                  variant="borderless"
                />
              </div>
              <div className="assistant-option">
                <AppstoreOutlined aria-hidden="true" /><span>功能</span>
                <Select
                  aria-label="功能选择（预览配置）"
                  value={taskType}
                  onChange={setTaskType}
                  options={[
                    { value: 'analysis', label: '病历分析' },
                    { value: 'patient', label: '患者档案' },
                    { value: 'document', label: '文档处理' },
                    { value: 'search', label: '知识检索' },
                  ]}
                  variant="borderless"
                />
              </div>
              <div className="assistant-option assistant-option--model">
                <RobotOutlined aria-hidden="true" /><span>模型</span>
                <Select
                  aria-label="模型选择（预览配置）"
                  placeholder={modelLoadFailed ? '加载失败' : '暂无可用模型'}
                  value={model}
                  onChange={setModel}
                  options={modelOptions}
                  loading={modelLoading}
                  disabled={!modelOptions.length}
                  variant="borderless"
                />
              </div>
            </div>
            <span className="assistant-preview-note" role="note"><InfoCircleOutlined />仅预览，不影响回答</span>
          </div>
          <Sender
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            onCancel={onCancel}
            loading={loading}
            disabled={!activeKey || loadingConversationKey === activeKey || loadErrorKey === activeKey}
            autoSize={{ minRows: 1, maxRows: 6 }}
            placeholder="提问或输入具体要求"
          />
        </div>
      </div>
    </div>
  );
}
