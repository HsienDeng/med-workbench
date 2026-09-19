import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bubble, Sender } from '@ant-design/x';
import { XMarkdown } from '@ant-design/x-markdown';
import type { GetProp } from 'antd';
import { Button, App as AntApp, Avatar, Tag, Typography } from 'antd';
import {
  UserOutlined,
  LoadingOutlined,
  FileTextOutlined,
  DownloadOutlined,
  ArrowRightOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import { colors } from '@/theme';
import assistantAvatar from '@/assets/assistant.png';
import {
  streamChat,
  getConversation,
  updateConversation,
  type ChatMessageInput,
} from '@/services/chat';
import { downloadDocumentFile } from '@/services/knowledge';
import { useXChat, type XAgent, type XMessage } from '@/hooks/useXChat';
import { toPersist } from '@/hooks/chatMessageState';
import { useConversationStore } from '@/stores/conversations';
import {
  DataAnalysisIcon,
  KnowledgeSearchIcon,
  MedicalQuestionIcon,
  RecordAnalysisIcon,
} from './CapabilityIcons';
import './index.css';

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const CAPABILITIES = [
  {
    key: 'knowledge',
    title: '医学知识问答',
    description: '疾病诊疗、药品说明与临床指南查询',
    prompt: '高血压患者常见的用药注意事项有哪些？',
    icon: <MedicalQuestionIcon />,
  },
  {
    key: 'record',
    title: '病历智能分析',
    description: '梳理病历内容，辅助识别关键信息',
    prompt: '请分析这份病历并给出可能的诊断方向',
    icon: <RecordAnalysisIcon />,
  },
  {
    key: 'retrieval',
    title: '知识库检索',
    description: '检索本机构资料与医学知识库',
    prompt: '查询阿司匹林与华法林的相互作用',
    icon: <KnowledgeSearchIcon />,
  },
  {
    key: 'data',
    title: '数据分析',
    description: '归纳指标变化，提炼可读结论',
    prompt: '帮我总结最新的临床指标要点',
    icon: <DataAnalysisIcon />,
  },
] as const;

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
  const conversations = useConversationStore((state) => state.conversations);
  const selectedConversationKey = useConversationStore((state) => state.activeKey);
  const loadConversations = useConversationStore((state) => state.loadConversations);
  const ensureDraft = useConversationStore((state) => state.ensureDraft);
  const selectConversation = useConversationStore((state) => state.selectConversation);
  const renameConversation = useConversationStore((state) => state.renameConversation);
  const [convInitialized, setConvInitialized] = useState(false);
  const [activeKey, setActiveKey] = useState('');
  const [input, setInput] = useState('');
  const [loadingConversationKey, setLoadingConversationKey] = useState('');
  const [loadErrorKey, setLoadErrorKey] = useState('');
  const storeRef = useRef<Record<string, XMessage[]>>({});
  const loadVersionRef = useRef(0);
  const saveQueueRef = useRef<Record<string, Promise<unknown>>>({});

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

  // 挂载：加载会话列表；空列表或新会话入口复用同一个草稿创建流程。
  useEffect(() => {
    let alive = true;
    const initialRequest = Boolean(location.state?.newConversation);
    const requestedKey = location.state?.conversationKey as string | undefined;
    if (initialRequest || requestedKey) {
      handledRequest.current = location.key;
      navigate('/assistant', { replace: true, state: null });
    }
    (async () => {
      try {
        const items = await loadConversations();
        if (!alive) return;
        const target = initialRequest
          ? await ensureDraft()
          : items.find((item) => item.key === requestedKey)
            ?? items.find((item) => item.key === selectedConversationKey)
            ?? items[0]
            ?? await ensureDraft();
        if (!alive) return;
        setActiveKey(target.key);
        selectConversation(target.key);
        activeKeyRef.current = target.key;
        const detail = await getConversation(Number(target.key));
        if (!alive) return;
        storeRef.current[target.key] = detail.messages.map(toXMessage);
        if (activeKeyRef.current === target.key) setMessages(storeRef.current[target.key]);
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
    selectConversation(key);
    const cached = storeRef.current[key];
    if (cached) {
      setMessages(cached);
    } else {
      setMessages([]);
      void loadConversation(Number(key));
    }
  };

  const newConversation = async () => {
    try {
      const draft = await ensureDraft();
      switchActive(draft.key);
    } catch {
      message.error('新建对话失败');
    }
  };

  useEffect(() => {
    if (!convInitialized || !location.state?.newConversation || handledRequest.current === location.key) return;
    handledRequest.current = location.key;
    navigate('/assistant', { replace: true, state: null });
    void newConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convInitialized, location.key]);

  useEffect(() => {
    if (!convInitialized || !selectedConversationKey || selectedConversationKey === activeKey) return;
    switchActive(selectedConversationKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convInitialized, selectedConversationKey]);

  const handleSend = (raw: string) => {
    const text = (raw ?? '').trim();
    if (!text || !activeKey || !onRequest(text)) return;
    setInput('');
    if (activeKey) {
      const activeConversation = conversations.find((item) => item.key === activeKey);
      if (activeConversation?.label === '新对话') renameConversation(activeKey, text.slice(0, 14));
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

  return (
    <div className="assistant-page">
      <div className="assistant-workspace">
        <div className={`assistant-main${isEmpty ? ' assistant-main--empty' : ''}`}>
          {loadErrorKey === activeKey || (loadErrorKey === 'initial' && !activeKey) ? (
            <div className="assistant-welcome">
              <p>对话加载失败</p>
              <Button onClick={() => activeKey ? void loadConversation(Number(activeKey)) : window.location.reload()}>重试加载</Button>
            </div>
          ) : loadingConversationKey === activeKey && activeKey ? (
            <div className="assistant-welcome"><LoadingOutlined /> 正在加载对话…</div>
          ) : isEmpty ? (
            <div className="assistant-empty-state">
              <div className="assistant-welcome">
                <img className="assistant-welcome-avatar" src={assistantAvatar} alt="" />
                <h1>你好，我是 MedAI</h1>
                <p>基于医疗知识库的智能助手，帮助你快速获取专业信息、分析病历、辅助决策。</p>
              </div>

              <div className="assistant-capability-grid" aria-label="对话能力">
                {CAPABILITIES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`assistant-capability assistant-capability--${item.key}`}
                    onClick={() => setInput(item.prompt)}
                  >
                    <span className="assistant-capability-icon" aria-hidden="true">{item.icon}</span>
                    <span className="assistant-capability-copy">
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </span>
                    <ArrowRightOutlined className="assistant-capability-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>

              <section className="assistant-suggestions" aria-labelledby="assistant-suggestions-title">
                <div className="assistant-suggestions-title" id="assistant-suggestions-title">
                  <BulbOutlined aria-hidden="true" />
                  <span>你可以这样问我</span>
                </div>
                <div className="assistant-suggestion-list">
                  {CAPABILITIES.map((item) => (
                    <button key={item.key} type="button" onClick={() => setInput(item.prompt)}>
                      <span>{item.prompt}</span>
                      <ArrowRightOutlined aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="assistant-messages"><Bubble.List autoScroll items={items} role={roles} /></div>
          )}
        </div>

        <div className="assistant-composer">
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
