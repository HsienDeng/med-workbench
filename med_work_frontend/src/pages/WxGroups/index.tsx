import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Card,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  EditOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  HistoryOutlined,
  ImportOutlined,
  LinkOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SendOutlined,
  SyncOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { GetProp } from 'antd';
import { Bubble, Conversations, Sender } from '@ant-design/x';
import dayjs from 'dayjs';
import { PageHead } from '@/components';
import PermGate from '@/components/PermGate';
import { usePermission } from '@/utils/access';
import {
  DICT_DEPT,
  FALLBACK_DEPT_OPTIONS,
} from '@/constants/dictionary';
import { useDictionaryOptions } from '@/hooks';
import { getPatients } from '@/services/patients';
import {
  bindWxGroupPatient,
  checkWecomApiLogin,
  createWecomApiDevice,
  createWxGroup,
  fetchWecomApiContacts,
  fetchWecomApiRoomMembers,
  fetchWecomApiRoomMessages,
  getWecomApiProfile,
  getWecomApiStatus,
  getWxStatus,
  importWecomApiGroups,
  listWecomApiRooms,
  listWxGroups,
  listWxMessages,
  refreshWxMessage,
  sendWxMessage,
  syncWxGroups,
  unbindWxGroupPatient,
  updateWxGroup,
} from '@/services/wx';
import type {
  PatientItem,
  WecomApiChatMessageItem,
  WecomApiContactItem,
  WecomApiProfile,
  WecomApiRoomItem,
  WecomApiRoomMember,
  WecomApiStatus,
  WxGroupCreatePayload,
  WxGroupItem,
  WxGroupUpdatePayload,
  WxMessageCreatePayload,
  WxMessageItem,
  WxStatus,
} from '@/types';
import './index.css';

const PAGE_SIZE = 20;

/** 聊天管理界面主色 */
const CHAT_PRIMARY = '#1677ff';

/** 聊天消息气泡角色：自己的消息靠右（蓝色）、他人靠左（白色） */
const CHAT_ROLES: GetProp<typeof Bubble.List, 'role'> = {
  self: {
    placement: 'end',
    variant: 'filled',
    styles: {
      content: {
        background: CHAT_PRIMARY,
        color: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 8px rgba(22, 119, 255, 0.18)',
      },
    },
  },
  other: {
    placement: 'start',
    variant: 'filled',
    styles: {
      content: {
        background: '#fff',
        color: 'rgba(15, 23, 42, 0.88)',
        borderRadius: 12,
        border: '1px solid #eef1f6',
        boxShadow: '0 1px 4px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  /** 群通知：系统消息卡片（居中由 .wx-chat-notice 控制） */
  notice: {
    placement: 'start',
    variant: 'filled',
    styles: {
      content: {
        background: 'rgba(15, 23, 42, 0.04)',
        color: 'rgba(15, 23, 42, 0.45)',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: '18px',
        padding: '4px 14px',
        boxShadow: 'none',
      },
    },
  },
};

/** 群跟进状态（企微 status 字段） */
const GROUP_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '正常', color: 'green' },
  1: { label: '离职待继承', color: 'orange' },
  2: { label: '离职继承中', color: 'gold' },
  3: { label: '离职继承完成', color: 'default' },
};

const MESSAGE_STATUS: Record<WxMessageItem['status'], { label: string; color: string }> = {
  pending: { label: '待群主确认', color: 'blue' },
  sent: { label: '已发送', color: 'green' },
  fail: { label: '失败', color: 'red' },
};

const BOUND_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'bound', label: '已绑定患者' },
  { value: 'unbound', label: '未绑定患者' },
];

type BoundFilter = (typeof BOUND_OPTIONS)[number]['value'];

function formatTime(value: string | null | undefined): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

/** wecomapi 平台消息时间戳（可能为秒或毫秒） */
function formatMsgTime(timestamp: number): string {
  if (!timestamp) return '—';
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  return dayjs(ms).format('MM-DD HH:mm:ss');
}

/** 判断成员是否为医护：管理员/群主、当前登录用户、或昵称命中医疗关键词 */
function isMedicalStaff(member: WecomApiRoomMember, selfUserId?: string): boolean {
  if (member.is_admin) return true;
  if (selfUserId && member.user_id === selfUserId) return true;
  const text = `${member.nickname} ${member.room_remark}`;
  return /医护|医生|护士|医师|主任|大夫|专家|药师|技师|Dr|dr/i.test(text);
}

/** 推送记录是否超过 7 天仍未确认（群主一直未在企业微信确认） */
function isConfirmTimeout(item: WxMessageItem): boolean {
  if (item.status !== 'pending' || !item.created_at) return false;
  return dayjs().diff(dayjs(item.created_at), 'day') > 7;
}

interface SendFormValues {
  msgType: 'text' | 'link';
  content?: string;
  title?: string;
  url?: string;
  picurl?: string;
  desc?: string;
}

interface GroupFormValues {
  name: string;
  owner?: string;
  owner_name?: string;
  member_count?: number;
  webhook_url?: string;
  wecomapi_room_id?: string;
}

type GroupModalMode = 'create' | 'edit';

/**
 * 群管理：企业微信外部群列表、患者绑定、企业群发推送。
 *
 * 平台约束：群发任务提交后需群主在企业微信客户端确认才会真正发送，
 * 因此推送记录存在 pending 中间态，可通过「刷新状态」回查。
 */
export default function WxGroups() {
  const { message } = AntApp.useApp();
  const can = usePermission();

  const [status, setStatus] = useState<WxStatus | null>(null);
  const [groups, setGroups] = useState<WxGroupItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [boundFilter, setBoundFilter] = useState<BoundFilter>('all');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [activeGroup, setActiveGroup] = useState<WxGroupItem | null>(null);
  const [bindOpen, setBindOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<GroupModalMode>('create');
  const [groupSaving, setGroupSaving] = useState(false);
  const [wecomApiStatus, setWecomApiStatus] = useState<WecomApiStatus | null>(null);
  const [wecomApiProfile, setWecomApiProfile] = useState<WecomApiProfile | null>(null);
  const [contactMap, setContactMap] = useState<Record<string, WecomApiContactItem>>({});

  // wecomapi 设备登录弹窗
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceGuid, setDeviceGuid] = useState('');
  const [deviceQrcode, setDeviceQrcode] = useState('');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState('');
  const [deviceDone, setDeviceDone] = useState(false);
  const [deviceConfigured, setDeviceConfigured] = useState(false);
  const deviceTimerRef = useRef<number | null>(null);

  // wecomapi 平台群导入弹窗（配置表单内回填 roomId）
  const [roomImportOpen, setRoomImportOpen] = useState(false);
  const [rooms, setRooms] = useState<WecomApiRoomItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  // wecomapi 获取群弹窗（全量拉取平台群，勾选后批量导入本地群列表）
  const [groupFetchOpen, setGroupFetchOpen] = useState(false);
  const [fetchRooms, setFetchRooms] = useState<WecomApiRoomItem[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchImporting, setFetchImporting] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<React.Key[]>([]);

  // 群列表 tab（左侧所有群 + 右侧聊天记录）
  const [activeTab, setActiveTab] = useState('overview');
  const [roomList, setRoomList] = useState<WecomApiRoomItem[]>([]);
  const [roomListLoading, setRoomListLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<WecomApiRoomItem | null>(null);
  const [roomMessages, setRoomMessages] = useState<WecomApiChatMessageItem[]>([]);
  const [roomMessagesLoading, setRoomMessagesLoading] = useState(false);
  const [roomMembers, setRoomMembers] = useState<WecomApiRoomMember[]>([]);
  const [roomMembersLoading, setRoomMembersLoading] = useState(false);
  const [roomKeyword, setRoomKeyword] = useState('');
  const [membersCollapsed, setMembersCollapsed] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatSending, setChatSending] = useState(false);

  const sortedRoomMessages = useMemo(() => {
    return [...roomMessages].sort((a, b) => a.timestamp - b.timestamp);
  }, [roomMessages]);

  /** 群聊列表：按关键词过滤 */
  const filteredRoomList = useMemo(() => {
    const kw = roomKeyword.trim().toLowerCase();
    if (!kw) return roomList;
    return roomList.filter((room) =>
      (room.room_name || room.room_id).toLowerCase().includes(kw),
    );
  }, [roomList, roomKeyword]);

  const selfName = useMemo(
    () => wecomApiProfile?.nickname || wecomApiStatus?.nickname || '',
    [wecomApiProfile?.nickname, wecomApiStatus?.nickname],
  );

  /** 选中的平台群是否已绑定本地推送配置（可发送消息） */
  const selectedRoomGroup = useMemo(
    () =>
      groups.find(
        (group) => group.wecomapi_room_id && group.wecomapi_room_id === selectedRoom?.room_id,
      ) ?? null,
    [groups, selectedRoom],
  );

  /** 聊天消息列表（含日期分割线 / 群通知），交给 Bubble.List 渲染 */
  const chatBubbleItems = useMemo<GetProp<typeof Bubble.List, 'items'>>(() => {
    const items: NonNullable<GetProp<typeof Bubble.List, 'items'>> = [];
    let lastDate = '';
    let seq = 0;
    const selfUserId = wecomApiProfile?.user_id;
    for (const msg of sortedRoomMessages) {
      // 过滤：无内容的消息（非文本占位）不展示
      if (!msg.content) continue;
      // 群通知：居中系统消息卡片
      if (msg.is_room_notice) {
        items.push({
          key: `notice-${msg.msg_server_id ?? seq++}`,
          role: 'notice',
          className: 'wx-chat-notice',
          content: msg.content,
        });
        continue;
      }
      // 未知成员（系统消息）不展示
      if (!msg.sender_name) continue;
      const ms = msg.timestamp > 1e12 ? msg.timestamp : msg.timestamp * 1000;
      const date = dayjs(ms).format('YYYY-MM-DD');
      if (date !== lastDate) {
        items.push({ key: `date-${date}`, role: 'divider', content: date });
        lastDate = date;
      }
      const contact = msg.sender_id ? contactMap[msg.sender_id] : undefined;
      const isSelf = selfUserId
        ? msg.sender_id === selfUserId
        : msg.sender_name === selfName;
      const avatarNode = (contact?.avatar_url || wecomApiProfile?.avatar_url) && isSelf ? (
        <Avatar size={28} src={wecomApiProfile?.avatar_url || contact?.avatar_url} />
      ) : contact?.avatar_url ? (
        <Avatar size={28} src={contact.avatar_url} />
      ) : (
        <Avatar
          size={28}
          style={{ backgroundColor: isSelf ? CHAT_PRIMARY : '#c0c4cc' }}
        >
          {msg.sender_name?.[0] ?? '?'}
        </Avatar>
      );
      items.push({
        key: `msg-${msg.msg_server_id ?? seq++}`,
        role: isSelf ? 'self' : 'other',
        avatar: avatarNode,
        header: (
          <div className="wx-chat-meta">
            <span className="wx-chat-name">{isSelf ? '我' : msg.sender_name}</span>
            <span className="wx-chat-time">{formatMsgTime(msg.timestamp)}</span>
          </div>
        ),
        content: msg.content,
      });
    }
    return items;
  }, [sortedRoomMessages, selfName, wecomApiProfile, contactMap]);

  /** 成员统计：医护人数（管理员/当前用户/医疗关键词） */
  const memberStaffCount = useMemo(
    () => roomMembers.filter((m) => isMedicalStaff(m, wecomApiProfile?.user_id)).length,
    [roomMembers, wecomApiProfile],
  );

  const [groupForm] = Form.useForm<GroupFormValues>();

  const [selectedPatient, setSelectedPatient] = useState<string | undefined>(undefined);
  // 绑定弹窗的患者档案数据（真实接口）
  const [patientList, setPatientList] = useState<PatientItem[]>([]);
  const [patientListLoading, setPatientListLoading] = useState(false);
  const [patientTotal, setPatientTotal] = useState(0);
  const [patientPage, setPatientPage] = useState(1);
  const [patientSearch, setPatientSearch] = useState('');
  const { labels: deptLabels } = useDictionaryOptions(DICT_DEPT, FALLBACK_DEPT_OPTIONS);
  const [messages, setMessages] = useState<WxMessageItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [sendForm] = Form.useForm<SendFormValues>();
  const msgType = Form.useWatch('msgType', sendForm) ?? 'text';

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getWxStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  const loadWecomApiStatus = useCallback(async () => {
    try {
      const status = await getWecomApiStatus();
      setWecomApiStatus(status);
      if (status.online) {
        try {
          setWecomApiProfile(await getWecomApiProfile());
        } catch {
          setWecomApiProfile(null);
        }
      }
    } catch {
      setWecomApiStatus(null);
      setWecomApiProfile(null);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWxGroups({
        keyword: searchKeyword || undefined,
        bound: boundFilter === 'all' ? undefined : boundFilter === 'bound',
        page,
        page_size: PAGE_SIZE,
      });
      setGroups(res.items);
      setTotal(res.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载群列表失败');
    } finally {
      setLoading(false);
    }
  }, [searchKeyword, boundFilter, page, message]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    void loadWecomApiStatus();
  }, [loadWecomApiStatus]);

  /** 停止扫码登录状态轮询 */
  const stopDevicePolling = useCallback(() => {
    if (deviceTimerRef.current !== null) {
      window.clearInterval(deviceTimerRef.current);
      deviceTimerRef.current = null;
    }
  }, []);

  /** 轮询扫码登录状态，登录成功后自动停止 */
  const startDevicePolling = useCallback(
    (guid: string) => {
      stopDevicePolling();
      const poll = async () => {
        try {
          const res = await checkWecomApiLogin(guid);
          setDeviceMsg(res.done ? `登录成功：${res.nickname || '企业微信用户'}` : res.message);
          if (res.done) {
            setDeviceDone(true);
            stopDevicePolling();
            void loadWecomApiStatus();
          }
        } catch (error) {
          setDeviceMsg(error instanceof Error ? error.message : '查询登录状态失败');
          stopDevicePolling();
        }
      };
      void poll();
      deviceTimerRef.current = window.setInterval(() => void poll(), 3000);
    },
    [loadWecomApiStatus, stopDevicePolling],
  );

  /** 打开设备登录弹窗：创建/复用设备并获取二维码 */
  const openDevice = useCallback(async () => {
    setDeviceOpen(true);
    setDeviceBusy(true);
    setDeviceQrcode('');
    setDeviceMsg('');
    setDeviceDone(false);
    setDeviceConfigured(false);
    try {
      const res = await createWecomApiDevice();
      setDeviceGuid(res.guid);
      setDeviceConfigured(res.configured);
      setDeviceQrcode(res.qrcode_base64);
      setDeviceMsg(res.message);
      if (res.configured) {
        const st = await getWecomApiStatus();
        setDeviceMsg(st.online ? '设备已在线，无需重新登录' : `设备离线：${st.message || '请检查 .env 配置'}`);
      } else {
        startDevicePolling(res.guid);
      }
    } catch (error) {
      setDeviceMsg(error instanceof Error ? error.message : '获取登录二维码失败');
    } finally {
      setDeviceBusy(false);
    }
  }, [startDevicePolling]);

  const closeDevice = useCallback(() => {
    stopDevicePolling();
    setDeviceOpen(false);
  }, [stopDevicePolling]);

  useEffect(() => stopDevicePolling, [stopDevicePolling]);

  /** 打开平台群导入弹窗 */
  const openRoomImport = useCallback(async () => {
    setRoomImportOpen(true);
    setRoomsLoading(true);
    setRooms([]);
    try {
      const res = await listWecomApiRooms();
      setRooms(res.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '拉取平台群列表失败');
    } finally {
      setRoomsLoading(false);
    }
  }, [message]);

  /** 选中平台群并回填 roomId */
  const pickRoom = useCallback(
    (room: WecomApiRoomItem) => {
      groupForm.setFieldValue('wecomapi_room_id', room.room_id);
      setRoomImportOpen(false);
    },
    [groupForm],
  );

  /** 打开获取群弹窗：全量分页拉取平台群列表 */
  const openGroupFetch = useCallback(async () => {
    setGroupFetchOpen(true);
    setFetchLoading(true);
    setFetchRooms([]);
    setSelectedRoomIds([]);
    try {
      const items: WecomApiRoomItem[] = [];
      let next = 0;
      // 循环翻页直到拉完全部平台群
      for (let guard = 0; guard < 20; guard += 1) {
        const res = await listWecomApiRooms(next);
        items.push(...res.items);
        if (!res.has_more || res.next_start_index < 0) break;
        next = res.next_start_index;
      }
      setFetchRooms(items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '获取平台群失败');
    } finally {
      setFetchLoading(false);
    }
  }, [message]);

  /** 把勾选的平台群批量导入到本地群列表 */
  const handleImportGroups = useCallback(async () => {
    if (selectedRoomIds.length === 0) {
      message.warning('请先勾选要导入的群');
      return;
    }
    setFetchImporting(true);
    try {
      const res = await importWecomApiGroups({
        room_ids: selectedRoomIds.map(String),
      });
      message.success(
        `导入完成：共 ${res.total} 个群，新增 ${res.added}，更新 ${res.updated}，失败 ${res.failed}`,
      );
      setGroupFetchOpen(false);
      setPage(1);
      await Promise.all([loadGroups(), loadStatus()]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      setFetchImporting(false);
    }
  }, [selectedRoomIds, loadGroups, loadStatus, message]);

  /** 全量拉取平台所有群（群列表 tab 左侧） */
  const loadRoomList = useCallback(async () => {
    setRoomListLoading(true);
    try {
      const items: WecomApiRoomItem[] = [];
      let next = 0;
      for (let guard = 0; guard < 20; guard += 1) {
        const res = await listWecomApiRooms(next);
        items.push(...res.items);
        if (!res.has_more || res.next_start_index < 0) break;
        next = res.next_start_index;
      }
      setRoomList(items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '拉取群列表失败');
    } finally {
      setRoomListLoading(false);
    }
  }, [message]);

  /** 选中群并拉取其聊天记录与成员列表 */
  const selectRoom = useCallback(
    async (room: WecomApiRoomItem) => {
      setSelectedRoom(room);
      setRoomMessages([]);
      setRoomMembers([]);
      setRoomMessagesLoading(true);
      setRoomMembersLoading(true);
      try {
        const [msgRes, memberRes] = await Promise.all([
          fetchWecomApiRoomMessages(room.room_id),
          fetchWecomApiRoomMembers(room.room_id),
        ]);
        setRoomMessages(msgRes.items);
        setRoomMembers(memberRes.items);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '拉取群消息失败');
      } finally {
        setRoomMessagesLoading(false);
        setRoomMembersLoading(false);
      }
    },
    [message],
  );

  /** 聊天输入框发送：调用既有推送接口（wecomapi 通道 sendText / Webhook 等） */
  const handleChatSend = useCallback(async () => {
    const content = chatText.trim();
    if (!content || !selectedRoom || !selectedRoomGroup) return;
    if (!can('wx_group:send')) {
      message.warning('当前账号无消息发送权限，请联系管理员');
      return;
    }
    setChatSending(true);
    try {
      const record = await sendWxMessage({
        group_id: selectedRoomGroup.id,
        msg_type: 'text',
        content,
      });
      if (record.status === 'fail') {
        message.warning(`发送失败：${record.fail_reason ?? '未知原因'}`);
      } else {
        message.success('已发送');
        setChatText('');
        await selectRoom(selectedRoom);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发送失败');
    } finally {
      setChatSending(false);
    }
  }, [can, chatText, message, selectRoom, selectedRoom, selectedRoomGroup]);

  /** 根据消息发送者批量拉取头像 */
  useEffect(() => {
    const ids = Array.from(
      new Set(sortedRoomMessages.map((m) => m.sender_id).filter(Boolean)),
    );
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const { items } = await fetchWecomApiContacts(ids as string[]);
        if (cancelled) return;
        setContactMap((prev) => ({
          ...prev,
          ...Object.fromEntries(items.map((item) => [item.user_id, item])),
        }));
      } catch {
        // 头像非关键信息，失败静默
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sortedRoomMessages]);

  useEffect(() => {
    if (activeTab === 'room-list') void loadRoomList();
  }, [activeTab, loadRoomList]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await syncWxGroups();
      message.success(
        `同步完成：共 ${res.total} 个群，新增 ${res.added}，更新 ${res.updated}，失败 ${res.failed}`,
      );
      setPage(1);
      await Promise.all([loadGroups(), loadStatus()]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  }, [loadGroups, loadStatus, message]);

  const openBind = useCallback((group: WxGroupItem) => {
    setActiveGroup(group);
    setPatientSearch('');
    setPatientPage(1);
    setSelectedPatient(group.patient_id ?? undefined);
    setBindOpen(true);
  }, []);

  const openCreateGroup = useCallback(() => {
    setGroupModalMode('create');
    groupForm.resetFields();
    setGroupModalOpen(true);
  }, [groupForm]);

  const openEditGroup = useCallback(
    (group: WxGroupItem) => {
      setGroupModalMode('edit');
      setActiveGroup(group);
      groupForm.setFieldsValue({
        name: group.name,
        owner: group.owner || undefined,
        owner_name: group.owner_name || undefined,
        member_count: group.member_count || undefined,
        webhook_url: group.webhook_url || undefined,
        wecomapi_room_id: group.wecomapi_room_id || undefined,
      });
      setGroupModalOpen(true);
    },
    [groupForm],
  );

  const handleGroupSave = useCallback(async () => {
    if (groupModalMode === 'edit' && !activeGroup) return;
    setGroupSaving(true);
    let values: GroupFormValues;
    try {
      values = await groupForm.validateFields();
    } catch (error) {
      setGroupSaving(false);
      return;
    }
    const base: Omit<WxGroupCreatePayload, 'name'> & { name?: string } = {
      owner: values.owner?.trim() || '',
      owner_name: values.owner_name?.trim() || '',
      member_count: values.member_count ?? 0,
      webhook_url: values.webhook_url?.trim() || '',
      wecomapi_room_id: values.wecomapi_room_id?.trim() || '',
    };
    try {
      if (groupModalMode === 'create') {
        await createWxGroup({ ...base, name: values.name.trim() } as WxGroupCreatePayload);
        message.success('群已添加');
      } else {
        const payload: WxGroupUpdatePayload = {
          ...base,
          name: values.name?.trim() || undefined,
        };
        await updateWxGroup(activeGroup!.id, payload);
        message.success('群信息已更新');
      }
      setGroupModalOpen(false);
      await loadGroups();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setGroupSaving(false);
    }
  }, [activeGroup, groupForm, groupModalMode, loadGroups, message]);

  const openSend = useCallback(
    (group: WxGroupItem) => {
      setActiveGroup(group);
      sendForm.resetFields();
      sendForm.setFieldsValue({ msgType: 'text' });
      setSendOpen(true);
    },
    [sendForm],
  );

  const openHistory = useCallback(
    async (group: WxGroupItem) => {
      setActiveGroup(group);
      setHistoryOpen(true);
      setHistoryLoading(true);
      try {
        const res = await listWxMessages({ group_id: group.id, page_size: 50 });
        setMessages(res.items);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '加载推送记录失败');
      } finally {
        setHistoryLoading(false);
      }
    },
    [message],
  );

  const loadPatients = useCallback(async () => {
    setPatientListLoading(true);
    try {
      const res = await getPatients({
        page: patientPage,
        page_size: 10,
        keyword: patientSearch.trim() || undefined,
      });
      setPatientList(res.items);
      setPatientTotal(res.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载患者档案失败');
    } finally {
      setPatientListLoading(false);
    }
  }, [patientPage, patientSearch, message]);

  useEffect(() => {
    if (bindOpen) void loadPatients();
  }, [bindOpen, loadPatients]);

  const handleBind = useCallback(async () => {
    if (!activeGroup) return;
    if (!selectedPatient) {
      message.warning('请先选择要绑定的患者');
      return;
    }
    const patient = patientList.find((item) => String(item.id) === selectedPatient);
    try {
      await bindWxGroupPatient(activeGroup.id, selectedPatient, patient?.name ?? '');
      message.success('绑定成功');
      setBindOpen(false);
      await loadGroups();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '绑定失败');
    }
  }, [activeGroup, selectedPatient, patientList, loadGroups, message]);

  const handleUnbind = useCallback(async () => {
    if (!activeGroup) return;
    try {
      await unbindWxGroupPatient(activeGroup.id);
      message.success('已解绑');
      setBindOpen(false);
      await loadGroups();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '解绑失败');
    }
  }, [activeGroup, loadGroups, message]);

  const handleSend = useCallback(async () => {
    if (!activeGroup) return;
    const values = await sendForm.validateFields();
    const payload: WxMessageCreatePayload = {
      group_id: activeGroup.id,
      msg_type: values.msgType,
    };
    if (values.msgType === 'link') {
      payload.title = values.title;
      payload.url = values.url;
      payload.picurl = values.picurl;
      payload.desc = values.desc;
    } else {
      payload.content = values.content;
    }
    try {
      const record = await sendWxMessage(payload);
      setSendOpen(false);
      if (record.status === 'fail') {
        message.warning(`推送失败：${record.fail_reason ?? '未知原因'}`);
      } else if (activeGroup?.webhook_url) {
        message.success('已通过群机器人 Webhook 发送成功');
      } else if (activeGroup?.wecomapi_room_id) {
        message.success('已通过第三方通道发送成功');
      } else {
        message.success('群发任务已提交，需群主在企业微信确认后发送');
      }
      await loadGroups();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提交群发失败');
    }
  }, [activeGroup, sendForm, loadGroups, message]);

  const handleRefreshMessage = useCallback(
    async (item: WxMessageItem) => {
      try {
        const updated = await refreshWxMessage(item.id);
        setMessages((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        message.info(`状态：${MESSAGE_STATUS[updated.status].label}`);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '刷新状态失败');
      }
    },
    [message],
  );

  const columns = useMemo<ColumnsType<WxGroupItem>>(
    () => [
      {
        title: '群名称',
        dataIndex: 'name',
        key: 'name',
        width: 240,
        ellipsis: true,
        render: (value: string, row) => (
          <Space direction="vertical" size={0}>
            <span style={{ fontWeight: 600 }}>{value || '(未命名群)'}</span>
            <Typography.Text type="secondary" style={{ fontSize: 11 }} className="mono">
              {row.chat_id}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: '成员数',
        key: 'members',
        width: 90,
        render: (_: unknown, row) => (
          <span>
            {row.member_count}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {' '}
              ({row.external_count} 外部)
            </Typography.Text>
          </span>
        ),
      },
      {
        title: '推送通道',
        key: 'channel',
        width: 120,
        render: (_: unknown, row) => {
          const tags: React.ReactNode[] = [];
          if (row.webhook_url) {
            tags.push(
              <Tooltip key="wh" title={row.webhook_url}>
                <Tag color="green">Webhook</Tag>
              </Tooltip>,
            );
          }
          if (row.wecomapi_room_id) {
            tags.push(
              <Tooltip key="wc" title={`roomId：${row.wecomapi_room_id}`}>
                <Tag color="purple">第三方</Tag>
              </Tooltip>,
            );
          }
          if (tags.length === 0) {
            tags.push(
              <Tooltip key="qw" title="未配置推送通道，推送将走企业群发（需企微凭证且群主确认）">
                <Tag color="default">企微群发</Tag>
              </Tooltip>,
            );
          }
          return <Space size={4}>{tags}</Space>;
        },
      },
      {
        title: '关联患者',
        key: 'patient',
        width: 140,
        render: (_: unknown, row) =>
          row.patient_id ? (
            <Space size={4}>
              <Tag color="blue">{row.patient_name || row.patient_id}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 11 }} className="mono">
                {row.patient_id}
              </Typography.Text>
            </Space>
          ) : (
            <Typography.Text type="secondary">未绑定</Typography.Text>
          ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 80,
        render: (value: number) => {
          const meta = GROUP_STATUS[value] ?? GROUP_STATUS[0];
          return <Tag color={meta.color}>{meta.label}</Tag>;
        },
      },
      {
        title: '最近同步',
        dataIndex: 'last_sync_at',
        key: 'last_sync_at',
        width: 120,
        render: (value: string | null) => formatTime(value),
      },
      {
        title: '操作',
        key: 'actions',
        width: 200,
        render: (_: unknown, row) => (
          <Space size={4}>
            <PermGate code="wx_group:update">
              <Button type="link" size="small" icon={<TeamOutlined />} onClick={() => openBind(row)}>
                绑定患者
              </Button>
            </PermGate>
            <PermGate code="wx_group:send">
              <Button
                type="link"
                size="small"
                icon={<SendOutlined />}
                onClick={() => openSend(row)}
                disabled={!row.owner && !row.webhook_url && !row.wecomapi_room_id}
              >
                推送
              </Button>
            </PermGate>
            <PermGate code="wx_group:update">
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEditGroup(row)}
              >
                配置
              </Button>
            </PermGate>
            <Button
              type="link"
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => void openHistory(row)}
            >
              记录
            </Button>
          </Space>
        ),
      },
    ],
    [openBind, openSend, openEditGroup, openHistory],
  );

  const messageColumns = useMemo<ColumnsType<WxMessageItem>>(
    () => [
      {
        title: '类型',
        dataIndex: 'msg_type',
        key: 'msg_type',
        width: 90,
        render: (value: WxMessageItem['msg_type']) => (
          <Tag color={value === 'link' ? 'purple' : 'blue'}>
            {value === 'link' ? '链接卡片' : '文本'}
          </Tag>
        ),
      },
      {
        title: '内容',
        key: 'content',
        ellipsis: true,
        render: (_: unknown, row) => (
          <Space direction="vertical" size={0}>
            <span>{row.title || row.content || '—'}</span>
            {row.url && (
              <Typography.Link href={row.url} target="_blank" style={{ fontSize: 11 }}>
                {row.url}
              </Typography.Link>
            )}
          </Space>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 160,
        render: (value: WxMessageItem['status'], row) => {
          const meta = MESSAGE_STATUS[value];
          const timeout = isConfirmTimeout(row);
          return (
            <Space size={4}>
              <Tag color={meta.color}>{meta.label}</Tag>
              {timeout && (
                <Tooltip title="超过 7 天群主仍未在企业微信确认">
                  <Tag color="default">已超时</Tag>
                </Tooltip>
              )}
              {value === 'fail' && row.fail_reason && (
                <Tooltip title={row.fail_reason}>
                  <Typography.Text type="danger" style={{ fontSize: 11 }}>
                    查看原因
                  </Typography.Text>
                </Tooltip>
              )}
            </Space>
          );
        },
      },
      {
        title: '发送时间',
        key: 'time',
        width: 150,
        render: (_: unknown, row) => formatTime(row.sent_at ?? row.created_at),
      },
      {
        title: '操作',
        key: 'actions',
        width: 90,
        render: (_: unknown, row) =>
          row.status === 'pending' ? (
            <PermGate code="wx_group:refresh">
              <Button type="link" size="small" onClick={() => void handleRefreshMessage(row)}>
                刷新状态
              </Button>
            </PermGate>
          ) : (
            '—'
          ),
      },
    ],
    [handleRefreshMessage],
  );

  const patientColumns = useMemo<ColumnsType<PatientItem>>(
    () => [
      { title: '患者编号', dataIndex: 'patient_no', key: 'patient_no', width: 150 },
      { title: '姓名', dataIndex: 'name', key: 'name', width: 110 },
      {
        title: '科室',
        dataIndex: 'dept',
        key: 'dept',
        width: 110,
        render: (v: string) => deptLabels[v] ?? '—',
      },
      { title: '主诊断', dataIndex: 'primary_diag', key: 'primary_diag', ellipsis: true },
    ],
    [deptLabels],
  );

  return (
    <div className="wx-page">
      <PageHead
        crumbs={[]}
        title="群管理"
        subtitle="企业微信外部客户群清单、患者绑定与健康宣教推送"
        dense
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={() => void loadGroups()}>
              刷新
            </Button>
            <PermGate code="wx_wecomapi:manage">
              <Button
                icon={<QrcodeOutlined />}
                onClick={() => void openDevice()}
                title="wecomapi 第三方通道：扫码登录设备后即可向外部群推送"
              >
                设备登录
              </Button>
            </PermGate>
            <PermGate code="wx_wecomapi:manage">
              <Button icon={<ImportOutlined />} onClick={() => void openGroupFetch()}>
                获取群
              </Button>
            </PermGate>
            <PermGate code="wx_group:create">
              <Button icon={<PlusOutlined />} onClick={openCreateGroup}>
                添加群
              </Button>
            </PermGate>
            <PermGate code="wx_group:sync">
              <Button
                type="primary"
                icon={<SyncOutlined spin={syncing} />}
                loading={syncing}
                onClick={() => void handleSync()}
              >
                同步群
              </Button>
            </PermGate>
          </>
        }
      />

      {status && !status.configured && !wecomApiStatus?.configured && (
        <Alert
          className="wx-alert"
          type="warning"
          showIcon
          message="企业微信未配置"
          description="「同步群」需配置 WX_CORP_ID 与 WX_CONTACT_SECRET；也可点击「添加群」手动维护群列表，并在企微群里添加群机器人后填入 Webhook 地址即可直接推送。"
        />
      )}

      <Tabs
        className="wx-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: '群总览',
            children: (
              <div className="wx-overview-pane">
                <Flex className="wx-toolbar" align="center" gap={10} wrap>
                  <Input.Search
          allowClear
          placeholder="搜索群名或群主"
          style={{ width: 240 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => {
            setPage(1);
            setSearchKeyword(value.trim());
          }}
        />
        <Select
          value={boundFilter}
          options={BOUND_OPTIONS}
          style={{ width: 150 }}
          onChange={(value) => {
            setPage(1);
            setBoundFilter(value);
          }}
        />
        {wecomApiStatus?.configured && (
          <Tooltip
            title={
              wecomApiStatus.online
                ? '第三方通道可用：点「获取群」可从平台拉取全部群并一键导入，配置了 roomId 的群可直接推送（试点）'
                : (wecomApiStatus.message || '设备离线，请打开「设备登录」排查')
            }
          >
            <Tag
              icon={wecomApiStatus.online ? <CheckCircleOutlined /> : <WarningOutlined />}
              color={wecomApiStatus.online ? 'success' : 'warning'}
              style={{ marginInlineEnd: 0 }}
            >
              {wecomApiStatus.online ? '第三方通道已就绪' : '第三方通道离线'}
            </Tag>
          </Tooltip>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {status?.last_sync_at
            ? `最近同步：${formatTime(status.last_sync_at)} · 共 ${status.group_count} 个群`
            : '暂无同步记录'}
        </Typography.Text>
      </Flex>

      <Card className="wx-card" styles={{ body: { padding: 0 } }}>
        <Table<WxGroupItem>
          rowKey="id"
          columns={columns}
          dataSource={groups}
          loading={loading}
          scroll={{ x: 990 }}
          locale={{
            emptyText:
              total === 0 ? (
                <Space direction="vertical" size={4}>
                  <TeamOutlined style={{ fontSize: 20, opacity: 0.4 }} />
                  <Typography.Text type="secondary">
                    暂无群，点右上角「获取群」从平台拉取，或「添加群」手动维护
                  </Typography.Text>
                </Space>
              ) : (
                '暂无数据'
              ),
          }}
                  pagination={{
                    current: page,
                    pageSize: PAGE_SIZE,
                    total,
                    showSizeChanger: false,
                    onChange: setPage,
                  }}
                />
                </Card>
              </div>
            ),
          },
          {
            key: 'room-list',
            label: '群列表',
            children: (
              <div className={`wx-room-pane${membersCollapsed ? ' wx-room-pane-members-collapsed' : ''}`}>
                <Card
                  className="wx-room-list-card"
                  title="群聊列表"
                  styles={{
                    body: {
                      padding: 0,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                    },
                  }}
                  extra={
                    <Button
                      size="small"
                      type="text"
                      icon={<ReloadOutlined />}
                      loading={roomListLoading}
                      onClick={() => void loadRoomList()}
                    />
                  }
                >
                  <div className="wx-room-search">
                    <Input.Search
                      allowClear
                      placeholder="搜索群名称"
                      value={roomKeyword}
                      onChange={(e) => setRoomKeyword(e.target.value)}
                    />
                  </div>
                  <div className="wx-room-list-scroll">
                    {roomListLoading && roomList.length === 0 ? (
                      <Flex align="center" justify="center" style={{ height: '100%', minHeight: 160 }}>
                        <Spin />
                      </Flex>
                    ) : filteredRoomList.length === 0 ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={roomKeyword ? '未找到匹配的群' : '暂无同步的群'}
                        style={{ marginTop: 80 }}
                      />
                    ) : (
                      <Conversations
                        items={filteredRoomList.map((room) => ({
                          key: room.room_id,
                          label: (
                            <span className="wx-room-label">
                              <span className="wx-room-name">{room.room_name || room.room_id}</span>
                              <span className="wx-room-count">{room.member_count ?? 0} 人</span>
                            </span>
                          ),
                        }))}
                        activeKey={selectedRoom?.room_id}
                        onActiveChange={(key) => {
                          const room = roomList.find((item) => item.room_id === String(key));
                          if (room) void selectRoom(room);
                        }}
                      />
                    )}
                  </div>
                </Card>
                <Card
                  className="wx-room-msg-card"
                  title={
                    selectedRoom ? (
                      <div className="wx-chat-title">
                        <span className="wx-chat-title-name">{selectedRoom.room_name || selectedRoom.room_id}</span>
                        <span className="wx-chat-title-sub">
                          {selectedRoom.room_id} · {roomMembers.length || selectedRoom.member_count || 0} 人
                        </span>
                      </div>
                    ) : (
                      '聊天记录'
                    )
                  }
                  styles={{
                    body: {
                      padding: 0,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                    },
                  }}
                  extra={
                    selectedRoom ? (
                      <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined />}
                        loading={roomMessagesLoading}
                        onClick={() => void selectRoom(selectedRoom)}
                      >
                        刷新
                      </Button>
                    ) : undefined
                  }
                >
                  {selectedRoom ? (
                    <>
                      <div className="wx-chat-list">
                        {roomMessagesLoading && sortedRoomMessages.length === 0 ? (
                          <Flex align="center" justify="center" style={{ height: '100%' }}>
                            <Spin />
                          </Flex>
                        ) : sortedRoomMessages.length === 0 ? (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="该群暂无消息"
                            style={{ marginTop: 120 }}
                          />
                        ) : (
                          <Bubble.List
                            className="wx-chat-bubbles"
                            autoScroll
                            style={{ height: '100%' }}
                            items={chatBubbleItems}
                            role={CHAT_ROLES}
                          />
                        )}
                      </div>
                      <Sender
                        className="wx-chat-sender"
                        value={chatText}
                        onChange={setChatText}
                        loading={chatSending}
                        disabled={!selectedRoomGroup || !wecomApiStatus?.online || chatSending}
                        placeholder={
                          !wecomApiStatus?.online
                            ? 'wecomapi 设备离线，暂不可发送'
                            : !selectedRoomGroup
                              ? '该群未绑定推送配置，暂不可发送（可在群总览中配置第三方通道）'
                              : '输入消息，回车发送'
                        }
                        onSubmit={() => void handleChatSend()}
                      />
                    </>
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="在左侧选择一个群以查看消息"
                      style={{ marginTop: 120 }}
                    />
                  )}
                </Card>
                <Card
                  className="wx-room-members-card"
                  title={selectedRoom ? `群成员 (${roomMembers.length})` : '群成员'}
                  styles={{ body: { padding: 0, overflow: 'auto' } }}
                  extra={
                    <Button
                      type="text"
                      size="small"
                      icon={membersCollapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
                      onClick={() => setMembersCollapsed((value) => !value)}
                      aria-label={membersCollapsed ? '展开群成员面板' : '收起群成员面板'}
                    />
                  }
                >
                  {!membersCollapsed && selectedRoom ? (
                    roomMembersLoading && roomMembers.length === 0 ? (
                      <Flex align="center" justify="center" style={{ height: '100%', minHeight: 160 }}>
                        <Spin />
                      </Flex>
                    ) : roomMembers.length === 0 ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="暂无成员"
                        style={{ marginTop: 80 }}
                      />
                    ) : (
                      <>
                        <div className="wx-members-stats">
                          <div className="wx-members-stat">
                            <b>{roomMembers.length}</b>
                            <span>成员</span>
                          </div>
                          <div className="wx-members-stat">
                            <b>{memberStaffCount}</b>
                            <span>医护</span>
                          </div>
                          <div className="wx-members-stat">
                            <b>{roomMembers.length - memberStaffCount}</b>
                            <span>患者</span>
                          </div>
                        </div>
                        <List<WecomApiRoomMember>
                          dataSource={roomMembers}
                          renderItem={(member) => {
                          const staff = isMedicalStaff(member, wecomApiProfile?.user_id);
                          const isSelf = !!wecomApiProfile?.user_id && member.user_id === wecomApiProfile.user_id;
                          return (
                            <List.Item style={{ paddingInline: 12 }}>
                              <List.Item.Meta
                                avatar={
                                  <Avatar
                                    src={member.avatar_url || undefined}
                                    style={{ backgroundColor: staff ? '#e6f4ff' : '#f2f4f7', color: staff ? CHAT_PRIMARY : 'rgba(15,23,42,0.55)' }}
                                  >
                                    {member.nickname?.[0] ?? '?'}
                                  </Avatar>
                                }
                                title={
                                  <Space size={4} wrap>
                                    <span>{member.nickname || member.user_id}</span>
                                    {isSelf ? (
                                      <Tag color="blue">我</Tag>
                                    ) : (
                                      member.is_admin && <Tag color="gold">管理员</Tag>
                                    )}
                                    <Tag color={staff ? 'green' : 'blue'} style={{ marginInlineEnd: 0 }}>
                                      {staff ? '医护' : '患者'}
                                    </Tag>
                                  </Space>
                                }
                                description={
                                  member.room_remark ||
                                  (member.join_time
                                    ? `加入时间 ${formatMsgTime(member.join_time)}`
                                    : member.user_id)
                                }
                              />
                            </List.Item>
                          );
                        }}
                        />
                        </>
                    )
                  ) : (
                    !membersCollapsed && (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="在左侧选择一个群以查看成员"
                        style={{ marginTop: 80 }}
                      />
                    )
                  )}
                </Card>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={`绑定患者${activeGroup ? ` · ${activeGroup.name || '未命名群'}` : ''}`}
        open={bindOpen}
        onCancel={() => setBindOpen(false)}
        onOk={() => void handleBind()}
        okText="确认绑定"
        cancelText="取消"
        width={720}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Flex justify="space-between" align="center">
            {activeGroup?.patient_id ? (
              <Button danger type="link" onClick={() => void handleUnbind()}>
                解除当前绑定
              </Button>
            ) : (
              <span />
            )}
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </Flex>
        )}
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          从患者档案中选择要关联的患者（每群一位）
        </Typography.Text>
        <Input.Search
          allowClear
          placeholder="搜索患者姓名 / 编号 / 主诊断"
          value={patientSearch}
          onChange={(event) => setPatientSearch(event.target.value)}
          onSearch={(value) => {
            setPatientSearch(value.trim());
            setPatientPage(1);
          }}
          style={{ marginBottom: 10 }}
        />
        <Table<PatientItem>
          rowKey={(record) => String(record.id)}
          size="small"
          loading={patientListLoading}
          columns={patientColumns}
          dataSource={patientList}
          scroll={{ x: 520, y: 300 }}
          pagination={{
            current: patientPage,
            pageSize: 10,
            total: patientTotal,
            size: 'small',
            showSizeChanger: false,
            onChange: (p) => setPatientPage(p),
          }}
          rowSelection={{
            type: 'radio',
            columnWidth: 44,
            selectedRowKeys: selectedPatient ? [selectedPatient] : [],
            onChange: (keys) => setSelectedPatient(keys[0] as string | undefined),
          }}
          onRow={(record) => ({
            onClick: () => setSelectedPatient(String(record.id)),
            style: { cursor: 'pointer' },
          })}
        />
      </Modal>

      <Modal
        title={`推送消息${activeGroup ? ` · ${activeGroup.name || '未命名群'}` : ''}`}
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        onOk={() => void handleSend()}
        okText="提交群发"
        cancelText="取消"
        width={600}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            activeGroup?.webhook_url
              ? '该群已配置 Webhook，将通过群机器人直接发送，无需群主确认'
              : activeGroup?.wecomapi_room_id
                ? '该群已配置第三方通道，将直接发送到外部群（试点）'
                : '该群未配置推送通道，将走企业群发，提交后需群主在企业微信客户端确认才会真正发送'
          }
        />
        <Form form={sendForm} layout="vertical" initialValues={{ msgType: 'text' }}>
          <Form.Item label="消息类型" name="msgType">
            <Segmented
              options={[
                { value: 'text', label: '文本' },
                { value: 'link', label: '链接卡片' },
              ]}
            />
          </Form.Item>

          {msgType === 'text' ? (
            <Form.Item
              label="文本内容"
              name="content"
              rules={[{ required: true, message: '请输入文本内容' }]}
            >
              <Input.TextArea rows={5} maxLength={4000} showCount />
            </Form.Item>
          ) : (
            <>
              {activeGroup?.webhook_url && (
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', marginBottom: 8, fontSize: 12 }}
                >
                  Webhook 通道不支持链接卡片，将以 markdown 链接形式发送
                </Typography.Text>
              )}
              <Form.Item
                label="标题"
                name="title"
                rules={[{ required: true, message: '请输入标题' }]}
              >
                <Input maxLength={128} />
              </Form.Item>
              <Form.Item
                label="链接"
                name="url"
                rules={[{ required: true, message: '请输入链接地址' }]}
              >
                <Input placeholder="https://" />
              </Form.Item>
              <Form.Item label="封面图片地址" name="picurl">
                <Input placeholder="选填，https://" />
              </Form.Item>
              <Form.Item label="摘要" name="desc">
                <Input.TextArea rows={3} maxLength={512} showCount />
              </Form.Item>
            </>
          )}
        </Form>
        {!activeGroup?.owner && !activeGroup?.webhook_url && !activeGroup?.wecomapi_room_id && (
          <Alert
            type="warning"
            showIcon
            message="该群缺少群主信息且未配置推送通道，无法发起推送，请先配置 Webhook 或第三方通道，或同步获取群主"
          />
        )}

        {activeGroup && !activeGroup.patient_id && (
          <Alert type="warning" showIcon style={{ marginTop: 12 }} message="该群尚未绑定患者" />
        )}
      </Modal>

      <Modal
        title={groupModalMode === 'create' ? '添加群' : `配置群信息 · ${activeGroup?.name || ''}`}
        open={groupModalOpen}
        onCancel={() => setGroupModalOpen(false)}
        okText={groupModalMode === 'create' ? '添加' : '保存'}
        confirmLoading={groupSaving}
        onOk={() => void handleGroupSave()}
        destroyOnClose
      >
        <Form form={groupForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            label="群名称"
            name="name"
            rules={[{ required: true, message: '请输入群名称' }]}
          >
            <Input maxLength={128} placeholder="如：高血压随访群" />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item label="群主 userid" name="owner" style={{ flex: 1 }}>
              <Input maxLength={64} placeholder="选填，企微成员 userid" />
            </Form.Item>
            <Form.Item label="群主姓名" name="owner_name" style={{ flex: 1 }}>
              <Input maxLength={64} placeholder="选填" />
            </Form.Item>
          </Flex>
          <Form.Item label="成员数" name="member_count">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="选填" />
          </Form.Item>
          <Form.Item
            label={
              <Space size={4}>
                <span>群机器人 Webhook 地址</span>
                <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
                  （配置后可直接推送，无需企微凭证）
                </Typography.Text>
              </Space>
            }
            name="webhook_url"
            rules={[
              {
                type: 'url',
                message: '请输入正确的 Webhook 地址',
              },
            ]}
          >
            <Input
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              allowClear
            />
          </Form.Item>
          <Form.Item
            label={
              <Space size={4}>
                <span>第三方通道群 ID（roomId）</span>
                <Button
                  type="link"
                  size="small"
                  icon={<ImportOutlined />}
                  onClick={() => void openRoomImport()}
                >
                  从平台导入
                </Button>
              </Space>
            }
            name="wecomapi_room_id"
          >
            <Input placeholder="wecomapi 平台群 ID（roomId）" allowClear />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            Webhook 仅适用于内部群（外部群无法添加官方群机器人）。如需向外部群自动推送，请先在右上角
            「设备登录」完成扫码，再通过「从平台导入」绑定群 ID。
          </Typography.Paragraph>
        </Form>
      </Modal>

      <Modal
        title="wecomapi 设备登录（试点）"
        open={deviceOpen}
        onCancel={closeDevice}
        footer={null}
        width={420}
        destroyOnClose
      >
        {deviceBusy && !deviceQrcode && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <ApiOutlined spin style={{ fontSize: 28, color: '#1677ff' }} />
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              正在创建设备并获取登录二维码…
            </Typography.Text>
          </div>
        )}
        {deviceQrcode && (
          <div style={{ textAlign: 'center' }}>
            <img
              src={`data:image/png;base64,${deviceQrcode}`}
              alt="登录二维码"
              style={{ width: 220, height: 220, borderRadius: 8 }}
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
              使用企业微信扫码登录该设备，保持后台在线（设备名：
              <span className="mono">med-workbench</span>）
            </Typography.Paragraph>
          </div>
        )}
        {deviceMsg && (
          <Alert
            type={deviceDone ? 'success' : deviceQrcode ? 'info' : 'error'}
            showIcon
            message={deviceMsg}
            style={{ marginTop: 12 }}
          />
        )}
        {deviceDone && !deviceConfigured && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 8 }}
            message="登录成功。请将以下配置写入后端 .env 并重启后端，通道即生效"
            description={
              <Typography.Text copyable className="mono" style={{ fontSize: 12 }}>
                WX_WECOMAPI_GUID={deviceGuid}
              </Typography.Text>
            }
          />
        )}
        {/* <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="该通道基于非官方协议，有风控/封号风险，仅建议用测试账号小范围试点"
        /> */}
      </Modal>

      <Modal
        title="从平台导入群（wecomapi）"
        open={roomImportOpen}
        onCancel={() => setRoomImportOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          选择目标群后自动回填「第三方通道群 ID」。若列表为空，请先在右上角「设备登录」完成扫码并保持在线。
        </Typography.Paragraph>
        <Table<WecomApiRoomItem>
          rowKey="room_id"
          size="small"
          loading={roomsLoading}
          dataSource={rooms}
          pagination={false}
          scroll={{ y: 320 }}
          columns={[
            {
              title: '群名称',
              dataIndex: 'room_name',
              ellipsis: true,
              render: (value: string, row) => (
                <Space direction="vertical" size={0}>
                  <span>{value || '(未命名群)'}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }} className="mono">
                    {row.room_id}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: '成员数',
              dataIndex: 'member_count',
              width: 100,
            },
          ]}
          onRow={(record) => ({
            onClick: () => pickRoom(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Modal>

      <Modal
        title="获取群（wecomapi）"
        open={groupFetchOpen}
        onCancel={() => setGroupFetchOpen(false)}
        width={720}
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => setGroupFetchOpen(false)}>
            取消
          </Button>,
          <Button
            key="import"
            type="primary"
            loading={fetchImporting}
            disabled={fetchLoading || selectedRoomIds.length === 0}
            onClick={() => void handleImportGroups()}
          >
            导入选中（{selectedRoomIds.length}）
          </Button>,
        ]}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          从 wecomapi 平台获取全部群，勾选后一键导入本地群列表（已存在的群按 roomId 自动更新）。
          若列表为空，请先在右上角「设备登录」完成扫码并保持在线。
        </Typography.Paragraph>
        <Table<WecomApiRoomItem>
          rowKey="room_id"
          size="small"
          loading={fetchLoading}
          dataSource={fetchRooms}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          rowSelection={{
            selectedRowKeys: selectedRoomIds,
            onChange: (keys) => setSelectedRoomIds(keys),
          }}
          columns={[
            { title: '群名称', dataIndex: 'room_name', ellipsis: true },
            { title: '成员数', dataIndex: 'member_count', width: 100 },
          ]}
        />
      </Modal>

      <Drawer
        title={`推送记录${activeGroup ? ` · ${activeGroup.name || '未命名群'}` : ''}`}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={820}
      >
        <Table<WxMessageItem>
          rowKey="id"
          size="small"
          columns={messageColumns}
          dataSource={messages}
          loading={historyLoading}
          scroll={{ x: 700 }}
          pagination={false}
          locale={{
            emptyText: (
              <Space direction="vertical" size={4}>
                <LinkOutlined style={{ fontSize: 20, opacity: 0.4 }} />
                <Typography.Text type="secondary">该群暂无推送记录</Typography.Text>
              </Space>
            ),
          }}
        />
      </Drawer>
    </div>
  );
}
