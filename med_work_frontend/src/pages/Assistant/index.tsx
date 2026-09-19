import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bubble, Sender } from '@ant-design/x';
import { XMarkdown } from '@ant-design/x-markdown';
import type { GetProp, MenuProps } from 'antd';
import { Button, App as AntApp, Avatar, Tag, Typography, Dropdown } from 'antd';
import {
  UserOutlined,
  LoadingOutlined,
  FileTextOutlined,
  DownloadOutlined,
  ArrowRightOutlined,
  BulbOutlined,
  SendOutlined,
  PaperClipOutlined,
  DownOutlined,
  ThunderboltOutlined,
  MedicineBoxOutlined,
  BookOutlined,
  CommentOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { colors } from '@/theme';
import assistantAvatar from '@/assets/assistant.png';
import {
  streamChat,
  getConversation,
  updateConversation,
  type ChatMessageInput,
} from '@/services/chat';
import { listPrompts, type PromptTemplate } from '@/services/prompts';
import { getAiConnections } from '@/services/api';
import type { AIConnectionResponse } from '@/types';
import { downloadDocumentFile, uploadDocumentApi } from '@/services/knowledge';
import { usePermission } from '@/utils/access';
import { useXChat, type XAgent, type XMessage } from '@/hooks/useXChat';
import { toPersist } from '@/hooks/chatMessageState';
import { useConversationStore } from '@/stores/conversations';
import PromptManageModal from './PromptManageModal';
import {
  DataAnalysisIcon,
  KnowledgeSearchIcon,
  MedicalQuestionIcon,
  RecordAnalysisIcon,
} from './CapabilityIcons';
import './index.css';

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** 模型胶囊左侧圆点的取色盘，按 provider 顺序轮转分配 */
const MODEL_DOT_COLORS = ['#7c4dff', '#2d6cdf', '#0b8f7f', '#c56a1a', '#d6455d'];

/** 预设提示词在下拉菜单中的固定图标（按名称匹配） */
const PRESET_ICON_BY_NAME: Record<string, React.ReactNode> = {
  病历分析助手: <FileSearchOutlined />,
  临床用药咨询: <MedicineBoxOutlined />,
  循证指南检索: <BookOutlined />,
  患者沟通助手: <CommentOutlined />,
  检查检验解读: <ExperimentOutlined />,
};

/** 提示词下拉菜单的菜单项 key 约定：'default'=默认助手，'p-<id>'=模板，'manage'=管理入口 */
const PROMPT_KEY_DEFAULT = 'default';
const PROMPT_KEY_MANAGE = 'manage';
const toPromptKey = (id: number) => `p-${id}`;

/** 聊天输入框可上传的文档类型（与后端 knowledge 上传接口白名单保持一致） */
const UPLOAD_ACCEPT = '.pdf,.docx,.txt,.md';

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

/** 助手消息上方的推理过程折叠面板（模型/网关支持时展示，生成中自动展开） */
function ThinkingPanel({ thinking, active }: { thinking: string; active: boolean }) {
  return (
    <details className="assistant-thinking" open={active}>
      <summary>
        <BulbOutlined aria-hidden="true" />
        <span className="assistant-thinking-title">思考过程</span>
        {active ? (
          <span className="assistant-thinking-live">
            <LoadingOutlined /> 思考中
          </span>
        ) : null}
      </summary>
      <div className="assistant-thinking-body">{thinking}</div>
    </details>
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

const CJK_CHAR = '[\\u4e00-\\u9fff\\u3000-\\u303f\\uff01-\\uff5e]';

/**
 * 归一化模型输出后再交给 XMarkdown 渲染。
 *
 * 部分模型/网关会在中文 token 之间带出空格、把换行压成空格，导致：
 * 1. 「你 好 ！」式的字间空白；
 * 2. Markdown 列表（"- "）、加粗（**）因失去换行/行首而解析失效，原样显示。
 *
 * 处理（``` 围栏内的代码块保持原样）：
 * - 「句末标点 + 空格 + "- "」还原为换行的列表项；
 * - 去掉中文字符之间的空格与换行（中文不需要词间空格）。
 */
const normalizeModelText = (raw: string): string =>
  raw
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        // 「。／；／！／： + 空白 + - 」→ 换行，恢复被压平的列表
        .replace(new RegExp(`([。；！：])[ \\t\\r\\n]+-(?=[ \\t*\\u4e00-\\u9fff])`, 'g'), '$1\n- ')
        // 中文（含全角标点）之间的空格/换行一律去掉
        .replace(
          new RegExp(`(?<=${CJK_CHAR})[ \\t\\r\\n]+(?=${CJK_CHAR})`, 'g'),
          '',
        );
    })
    .join('');

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
  const [aiConnections, setAiConnections] = useState<AIConnectionResponse[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<string | null>(null);
  const promptContentRef = useRef<string | null>(null);
  const convPromptRef = useRef<Record<string, number | null>>({});
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
            model: modelRef.current ?? undefined,
            systemPrompt: promptContentRef.current ?? undefined,
            signal: cb.signal,
            onChunk: cb.onUpdate,
            onThinking: cb.onThinking,
            onCitations: cb.onCitations,
            onDone: cb.onSuccess,
            onError: cb.onError,
          },
        );
      },
    }),
    [],
  );

  // 拉取 AI 连接与可用模型，构造 (provider/model) 选项
  useEffect(() => {
    let alive = true;
    void getAiConnections()
      .then((items) => {
        if (!alive) return;
        const enabled = items.filter((item) => item.enabled && item.has_api_key && item.models?.length);
        setAiConnections(enabled);
        // 默认选中第一个启用 provider 的 active_model；用户后续可手动切换
        if (!selectedModel) {
          const firstActive = enabled[0]?.active_model ?? null;
          setSelectedModel(firstActive);
          modelRef.current = firstActive;
        }
      })
      .catch(() => {
        /* AI 连接拉取失败不影响主流程，模型下拉显示为空 */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** model → 展示用 provider 名与圆点颜色（下拉里同名模型只保留首次出现的 provider） */
  const modelMeta = useMemo(() => {
    const meta: Record<string, { provider: string; model: string; color: string }> = {};
    aiConnections.forEach((conn, index) => {
      const color = MODEL_DOT_COLORS[index % MODEL_DOT_COLORS.length];
      conn.models.forEach((model) => {
        if (!meta[model]) meta[model] = { provider: conn.name, model, color };
      });
    });
    return meta;
  }, [aiConnections]);

  const currentModel = selectedModel ? modelMeta[selectedModel] : undefined;

  const modelMenuItems = useMemo(
    () =>
      aiConnections.flatMap((conn) =>
        conn.models.map((model) => ({ key: model, label: model })),
      ),
    [aiConnections],
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
      convPromptRef.current[key] = detail.prompt_id ?? null;
      setSelectedPromptId(detail.prompt_id ?? null);
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
        convPromptRef.current[target.key] = detail.prompt_id ?? null;
        if (activeKeyRef.current === target.key) {
          setSelectedPromptId(detail.prompt_id ?? null);
          setMessages(storeRef.current[target.key]);
        }
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
    setSelectedPromptId(convPromptRef.current[key] ?? null);
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

  // selectedModel → modelRef 同步（agent.request 闭包读取最新值）
  useEffect(() => {
    modelRef.current = selectedModel;
  }, [selectedModel]);

  // 拉取提示词模板列表（预设 + 本人自建）
  useEffect(() => {
    let alive = true;
    void listPrompts()
      .then((list) => {
        if (alive) setPrompts(list);
      })
      .catch(() => {
        /* 提示词拉取失败不影响主流程，下拉显示为默认助手 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 选中模板 → 内容引用同步（agent.request 闭包读取最新值；模板被删则视为默认助手）
  useEffect(() => {
    promptContentRef.current = selectedPromptId
      ? prompts.find((item) => item.id === selectedPromptId)?.content ?? null
      : null;
  }, [selectedPromptId, prompts]);

  const currentPrompt = selectedPromptId
    ? prompts.find((item) => item.id === selectedPromptId)
    : undefined;

  const promptMenuItems = useMemo<MenuProps['items']>(() => {
    const renderLabel = (item: PromptTemplate) => (
      <span className="assistant-prompt-menu-item">
        {PRESET_ICON_BY_NAME[item.name] ?? <ThunderboltOutlined />}
        {item.name}
      </span>
    );
    const items: NonNullable<MenuProps['items']> = [
      {
        key: PROMPT_KEY_DEFAULT,
        label: (
          <span className="assistant-prompt-menu-item">
            <ThunderboltOutlined />
            默认助手
          </span>
        ),
      },
    ];
    items.push({
      type: 'group',
      label: '提示词',
      children: prompts.length
        ? prompts.map((item) => ({ key: toPromptKey(item.id), label: renderLabel(item) }))
        : [{ key: 'prompts-empty', disabled: true, label: '暂无提示词' }],
    });
    items.push(
      { type: 'divider' },
      {
        key: PROMPT_KEY_MANAGE,
        label: (
          <span className="assistant-prompt-menu-item">
            <SettingOutlined />
            管理提示词…
          </span>
        ),
      },
    );
    return items;
  }, [prompts]);

  /** 选择提示词：更新本轮生效内容并持久化到当前会话 */
  const handleSelectPrompt = (key: string) => {
    if (key === PROMPT_KEY_MANAGE) {
      setManageOpen(true);
      return;
    }
    const id = key === PROMPT_KEY_DEFAULT ? null : Number(key.slice(2));
    if (id && !prompts.some((item) => item.id === id)) return;
    setSelectedPromptId(id);
    if (activeKeyRef.current) {
      const convKey = activeKeyRef.current;
      convPromptRef.current[convKey] = id;
      void updateConversation(Number(convKey), { promptId: id ?? 0 }).catch(() => {
        /* 持久化失败仅影响下次进入时的恢复，不打断对话 */
      });
    }
  };

  /** 管理弹窗增删改后同步下拉选项；选中模板被删时回退默认助手 */
  const handlePromptsChanged = (list: PromptTemplate[]) => {
    setPrompts(list);
    setSelectedPromptId((prev) => (prev && list.some((item) => item.id === prev) ? prev : null));
  };

  const can = usePermission();
  // 上传到知识库需要 knowledge_document:upload；无权限的账号不展示「文件」按钮
  const canUpload = can('knowledge_document:upload');

  /** 选中文件后上传到本机构知识库（可被后续提问检索引用） */
  const handleUploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 先清空 value，保证同一文件可以重复选择触发 change
    event.target.value = '';
    if (!file || uploadingFile) return;
    setUploadingFile(true);
    try {
      await uploadDocumentApi({ file, title: file.name });
      message.success(`「${file.name}」已上传到知识库，可继续向我提问`);
    } catch {
      // 错误提示已由 api.ts 全局处理
    } finally {
      setUploadingFile(false);
    }
  };

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
    if (m.role === 'assistant' && m.status === 'loading' && !m.content && !m.thinking) {
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
        {m.thinking ? <ThinkingPanel thinking={m.thinking} active={m.status === 'loading'} /> : null}
        {m.content ? (
          <XMarkdown
            content={normalizeModelText(m.content)}
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
          <input
            ref={fileInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            hidden
            onChange={(event) => void handleUploadFile(event)}
          />
          <Sender
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            onCancel={onCancel}
            loading={loading}
            disabled={!activeKey || loadingConversationKey === activeKey || loadErrorKey === activeKey}
            autoSize={{ minRows: 1, maxRows: 6 }}
            placeholder="发送消息..."
            suffix={false}
            footer={(_, { components: { SendButton, LoadingButton } }) => (
              <div className="assistant-composer-tools">
                <div className="assistant-composer-tools-left">
                  {canUpload ? (
                    <button
                      type="button"
                      className="assistant-tool-pill"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile}
                      title="上传文件到知识库"
                    >
                      {uploadingFile ? <LoadingOutlined /> : <PaperClipOutlined />}
                      <span>文件</span>
                    </button>
                  ) : null}
                  {aiConnections.length > 0 ? (
                    <Dropdown
                      trigger={['click']}
                      placement="topLeft"
                      disabled={loading}
                      menu={{
                        items: modelMenuItems,
                        selectedKeys: selectedModel ? [selectedModel] : [],
                        onClick: ({ key }) => setSelectedModel(key),
                      }}
                    >
                      <button
                        type="button"
                        className="assistant-tool-pill assistant-tool-pill--model"
                        aria-label="切换模型"
                        title="切换模型"
                      >
                        <span
                          className="assistant-model-dot"
                          style={{ background: currentModel?.color ?? MODEL_DOT_COLORS[0] }}
                        />
                        <span className="assistant-model-name">
                          {currentModel ? currentModel.model : '选择模型'}
                        </span>
                        <DownOutlined className="assistant-tool-pill-caret" />
                      </button>
                    </Dropdown>
                  ) : null}
                  <Dropdown
                    trigger={['click']}
                    placement="topLeft"
                    disabled={loading}
                    menu={{
                      items: promptMenuItems,
                      selectedKeys: [selectedPromptId ? toPromptKey(selectedPromptId) : PROMPT_KEY_DEFAULT],
                      onClick: ({ key }) => handleSelectPrompt(key),
                    }}
                  >
                    <button
                      type="button"
                      className={`assistant-tool-pill assistant-tool-pill--prompt${selectedPromptId ? ' assistant-tool-pill--active' : ''}`}
                      aria-label="切换提示词"
                      title="切换提示词"
                    >
                      <ThunderboltOutlined />
                      <span className="assistant-prompt-name">
                        {currentPrompt?.name ?? '默认助手'}
                      </span>
                      <DownOutlined className="assistant-tool-pill-caret" />
                    </button>
                  </Dropdown>
                </div>
                {loading ? <LoadingButton /> : <SendButton icon={<SendOutlined />} shape="circle" type="primary" />}
              </div>
            )}
          />
        </div>
      </div>
      <PromptManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={handlePromptsChanged}
      />
    </div>
  );
}
