"""企业微信外部群管理的请求/响应模型。"""

from datetime import datetime

from pydantic import BaseModel, Field


class WxGroupOut(BaseModel):
    """群列表项（附带当前医院绑定的患者）。"""

    id: int
    chat_id: str
    name: str
    owner: str
    owner_name: str
    member_count: int
    webhook_url: str | None = None
    wecomapi_room_id: str | None = None
    external_count: int
    status: int
    last_sync_at: datetime | None = None
    patient_id: str | None = None
    patient_name: str | None = None


class WxGroupDetail(WxGroupOut):
    """群详情（含绑定时间）。"""

    bind_at: datetime | None = None
    bind_by: int | None = None


class WxGroupListResponse(BaseModel):
    """群分页列表。"""

    items: list[WxGroupOut] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class WxGroupCreateIn(BaseModel):
    """手动添加群请求（无企微凭证时的本地维护入口）。"""

    name: str = Field(min_length=1, max_length=128)
    owner: str = Field(default="", max_length=64, description="群主 userid（推送时作为 sender）")
    owner_name: str = Field(default="", max_length=64)
    member_count: int = Field(default=0, ge=0)
    webhook_url: str | None = Field(default=None, max_length=512, description="群机器人 Webhook 地址")
    wecomapi_room_id: str | None = Field(default=None, max_length=64, description="wecomapi 平台群 ID(roomId)")


class WxGroupUpdateIn(BaseModel):
    """更新群信息（主要维护 webhook_url / 群主 / 成员数）。"""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    owner: str | None = Field(default=None, max_length=64)
    owner_name: str | None = Field(default=None, max_length=64)
    member_count: int | None = Field(default=None, ge=0)
    webhook_url: str | None = Field(default=None, max_length=512)
    wecomapi_room_id: str | None = Field(default=None, max_length=64, description="传 None 清空")


class WxGroupSyncResult(BaseModel):
    """同步结果统计。"""

    total: int = 0
    added: int = 0
    updated: int = 0
    failed: int = 0
    synced_at: datetime | None = None


class WxStatusOut(BaseModel):
    """集成状态（不暴露任何凭证，仅返回是否已配置）。"""

    configured: bool = False
    sync_enabled: bool = False
    last_sync_at: datetime | None = None
    group_count: int = 0


class PatientBindIn(BaseModel):
    """绑定患者请求（患者数据目前来自前端 mock，后端只存快照）。"""

    patient_id: str = Field(min_length=1, max_length=64)
    patient_name: str = Field(default="", max_length=64)


class WxMessageCreateIn(BaseModel):
    """发起群发请求。"""

    group_id: int
    msg_type: str = Field(default="text", description="text / link")
    content: str | None = Field(default=None, description="文本内容（msg_type=text 时必填）")
    title: str | None = Field(default=None, max_length=256, description="链接卡片标题（msg_type=link 时必填）")
    url: str | None = Field(default=None, max_length=2048, description="链接地址（msg_type=link 时必填）")
    picurl: str | None = Field(default=None, max_length=2048, description="链接封面地址")
    desc: str | None = Field(default=None, max_length=512, description="链接摘要")


class WxMessageOut(BaseModel):
    """推送记录。"""

    id: int
    group_id: int
    group_name: str
    patient_id: str | None = None
    patient_name: str | None = None
    msg_type: str
    title: str | None = None
    content: str | None = None
    url: str | None = None
    picurl: str | None = None
    sender: str
    status: str
    fail_reason: str | None = None
    sent_at: datetime | None = None
    created_at: datetime | None = None


class WxMessageListResponse(BaseModel):
    """推送记录分页列表。"""

    items: list[WxMessageOut] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


# ==================== wecomapi 第三方通道（试点） ====================


class WecomApiLoginReq(BaseModel):
    """扫码登录状态轮询请求。"""

    guid: str = Field(min_length=1, max_length=64, description="设备 guid（创建设备接口返回）")


class WecomApiDeviceOut(BaseModel):
    """创建设备 + 登录二维码响应。"""

    guid: str = ""
    qrcode_base64: str = ""
    configured: bool = False  # guid 是否已与配置一致（登录后无需再写入 .env）
    message: str = ""


class WecomApiLoginStatusOut(BaseModel):
    """扫码登录状态（轮询用）。"""

    guid: str
    status: int = -1          # 平台 loginQrcodeStatus
    done: bool = False        # status == 2 登录成功
    nickname: str = ""
    corp_name: str = ""
    message: str = ""


class WecomApiStatusOut(BaseModel):
    """wecomapi 通道状态（不含凭证）。"""

    configured: bool = False  # Token + guid 是否就绪
    token_set: bool = False   # 是否已填 Token
    online: bool = False
    nickname: str = ""
    corp_name: str = ""
    message: str = ""


class WecomApiRoomItem(BaseModel):
    """wecomapi 平台群（导入候选）。"""

    room_id: str
    room_name: str = ""
    member_count: int = 0


class WecomApiRoomsOut(BaseModel):
    """wecomapi 群列表（分页）。"""

    items: list[WecomApiRoomItem] = Field(default_factory=list)
    has_more: bool = False
    next_start_index: int = -1


class WecomApiGroupImportIn(BaseModel):
    """把 wecomapi 平台群导入到本地群列表（获取群勾选导入）。"""

    room_ids: list[str] = Field(default_factory=list, description="选中的平台群 roomId 列表")
    sync_all: bool = Field(default=False, description="是否全量同步（忽略 room_ids）")


class WecomApiChatMessageItem(BaseModel):
    """wecomapi 平台单条群消息（聊天记录）。"""

    msg_server_id: int = 0
    from_room_id: str = ""
    is_room_notice: bool = False
    sender_id: str = ""
    sender_name: str = ""
    content: str = ""
    msg_type: int = 0
    timestamp: int = 0
    seq: int = 0


class WecomApiRoomMessagesOut(BaseModel):
    """wecomapi 群聊天记录。"""

    items: list[WecomApiChatMessageItem] = Field(default_factory=list)
    total: int = 0


class WecomApiProfileOut(BaseModel):
    """wecomapi 当前登录账号资料。"""

    user_id: str = ""
    nickname: str = ""
    avatar_url: str = ""
    alias: str = ""
    mobile: str = ""


class WecomApiContactItem(BaseModel):
    """wecomapi 联系人详情（用于消息头像）。"""

    user_id: str = ""
    nickname: str = ""
    avatar_url: str = ""


class WecomApiContactsBatchOut(BaseModel):
    """wecomapi 批量联系人详情。"""

    items: list[WecomApiContactItem] = Field(default_factory=list)


class WecomApiRoomMemberItem(BaseModel):
    """wecomapi 群成员。"""

    user_id: str = ""
    nickname: str = ""
    avatar_url: str = ""
    room_remark: str = ""
    is_admin: bool = False
    join_time: int = 0


class WecomApiRoomMembersOut(BaseModel):
    """wecomapi 群成员列表。"""

    room_name: str = ""
    items: list[WecomApiRoomMemberItem] = Field(default_factory=list)
