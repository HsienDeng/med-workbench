import { useEffect, useMemo, useRef, useState } from 'react';
import { Conversations, Bubble, Sender, Prompts, Welcome } from '@ant-design/x';
import type { GetProp } from 'antd';
import { Button, App as AntApp, Avatar, Tag, Typography } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  UserOutlined,
  LoadingOutlined,
  FileTextOutlined,
  DownloadOutlined,
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
import { useXChat, type XAgent, type XMessage } from '@/hooks/useXChat';

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

const SUGGESTIONS = [
  { key: 's1', label: '总结病历要点', description: '提取主诉、诊断与用药建议' },
  { key: 's2', label: '解读检验报告', description: '解释异常指标的临床含义' },
  { key: 's3', label: '给出用药建议', description: '基于指南的方案推荐' },
  { key: 's4', label: '检索相关指南', description: '查找循证依据与参考文献' },
];

/** 只持久化完整消息：user 全存；assistant 仅在完成 / 出错时存（避免存到流式中途内容） */
const toPersist = (msgs: XMessage[]) =>
  msgs
    .filter((m) => m.role === 'user' || m.status === 'done' || m.status === 'error')
    .map((m) => ({
      role: m.role,
      content: m.content,
      citations: m.citations?.length ? m.citations : null,
    }));

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
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [convInitialized, setConvInitialized] = useState(false);
  const [activeKey, setActiveKey] = useState('');
  const [input, setInput] = useState('');
  const storeRef = useRef<Record<string, XMessage[]>>({});

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

  /** 拉取并应用指定会话的消息（仅当仍是当前激活会话时落地） */
  const loadConversation = useMemo(
    () => async (convId: number) => {
      try {
        const detail = await getConversation(convId);
        const key = String(convId);
        const msgs = detail.messages.map(toXMessage);
        storeRef.current[key] = msgs;
        if (activeKeyRef.current === key) setMessages(msgs);
      } catch {
        message.error('会话内容加载失败');
      }
    },
    [setMessages, message],
  );

  // 挂载：加载会话列表；空则新建一个
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let list = await listConversations();
        if (!list.length) {
          const created = await createConversation();
          list = [created];
        }
        if (!alive) return;
        const items: Conv[] = list.map((c) => ({ key: String(c.id), label: c.title }));
        setConversations(items);
        setActiveKey(items[0].key);
        const detail = await getConversation(list[0].id);
        if (!alive) return;
        storeRef.current[items[0].key] = detail.messages.map(toXMessage);
        setMessages(storeRef.current[items[0].key]);
      } catch {
        if (alive) message.error('对话历史加载失败');
      } finally {
        if (alive) setConvInitialized(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 消息变化 → 防抖 800ms 保存当前会话（切换会话 / 卸载时在清理阶段立即补存）
  useEffect(() => {
    if (!convInitialized || !activeKey) return;

    const timer = window.setTimeout(() => {
      const key = activeKeyRef.current;
      const item = conversationsRef.current.find((c) => c.key === key);
      if (!item) return;
      const persisted = toPersist(storeRef.current[key] ?? []);
      if (!persisted.length) return;
      void updateConversation(Number(key), { title: item.label, messages: persisted }).catch(
        () => {
          /* 静默失败：下次消息变化会再次触发保存 */
        },
      );
    }, 800);

    return () => {
      window.clearTimeout(timer);
      // 防抖窗口内被中断（如切换会话、卸载）时立即补存，避免丢消息
      const key = activeKeyRef.current;
      const item = conversationsRef.current.find((c) => c.key === key);
      if (item) {
        const persisted = toPersist(storeRef.current[key] ?? []);
        if (persisted.length) {
          void updateConversation(Number(key), {
            title: item.label,
            messages: persisted,
          }).catch(() => undefined);
        }
      }
    };
  }, [messages, convInitialized, activeKey, conversations]);

  const switchActive = (key: string) => {
    if (key === activeKey) return;
    onCancel();
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
    try {
      const created = await createConversation();
      const item: Conv = { key: String(created.id), label: created.title };
      storeRef.current[item.key] = [];
      setConversations((prev) => [item, ...prev]);
      setActiveKey(item.key);
      setMessages([]);
    } catch {
      message.error('新建对话失败');
    }
  };

  const removeConv = async (key: string) => {
    const convId = Number(key);
    if (key === activeKey) onCancel();
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
    if (!text) return;
    if (activeKey) {
      setConversations((prev) =>
        prev.map((c) => (c.key === activeKey && c.label === '新对话' ? { ...c, label: text.slice(0, 14) } : c)),
      );
    }
    onRequest(text);
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
    return (
      <div>
        <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
        {m.role === 'assistant' && m.citations?.length ? <CitationList citations={m.citations} /> : null}
      </div>
    );
  };

  const items = messages.map((m) => ({ key: m.id, role: m.role, content: renderContent(m) }));
  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', overflow: 'hidden', background: '#fff' }}>
      <div
        style={{
          width: 264,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          background: colors.bgSecondary,
        }}
      >
        <div style={{ padding: 12, borderBottom: `1px solid ${colors.border}` }}>
          <Button type="primary" icon={<PlusOutlined />} block onClick={() => void newConversation()}>
            新建对话
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          <Conversations
            items={conversations.map((c) => ({ key: c.key, label: c.label }))}
            activeKey={activeKey}
            onActiveChange={(k) => switchActive(String(k))}
            menu={(conv) => ({
              items: [{ key: 'delete', label: '删除对话', icon: <DeleteOutlined /> }],
              onClick: () => void removeConv(String(conv.key)),
            })}
          />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
          <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px' }}>
            {isEmpty ? (
              <div style={{ paddingTop: '8vh', textAlign: 'center' }}>
                <Welcome
                  icon={<img src={assistantAvatar} alt="AI 医疗助手" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />}
                  title="AI 医疗助手"
                  description="基于临床指南与知识库的智能问答，可协助总结病历、解读报告、给出建议。"
                />
                <div style={{ maxWidth: 620, margin: '28px auto 0' }}>
                  <Prompts
                    items={SUGGESTIONS.map((s) => ({ key: s.key, label: s.label, description: s.description }))}
                    onItemClick={(info) => handleSend(String(info.data.label))}
                    wrap
                  />
                </div>
              </div>
            ) : (
              <Bubble.List autoScroll items={items} role={roles} />
            )}
          </div>
        </div>

        <div style={{ padding: '12px 24px 20px', borderTop: `1px solid ${colors.border}`, background: '#fff' }}>
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <Sender
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              onCancel={onCancel}
              loading={loading}
              placeholder="输入问题，向 AI 助手咨询（Enter 发送，Shift + Enter 换行）"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
