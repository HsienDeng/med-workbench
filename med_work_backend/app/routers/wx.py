"""企业微信外部群管理 API：群同步、患者绑定、企业群发。

鉴权：全部接口按功能权限点拦截——wx_group:* 覆盖群与消息读写，
wx_wecomapi:view / manage 覆盖第三方 wecomapi 通道；默认仅医院管理员持有。
绑定关系与推送记录按 hospital_id 隔离；群快照为企业维度全局共享。
"""
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import require_permission
from app.exceptions import NotFoundError, WxBadRequest
from app.models import RbacUser, WxGroupPatient, WxMessage
from app.schemas.wx import (
    PatientBindIn,
    WecomApiContactsBatchOut,
    WecomApiDeviceOut,
    WecomApiGroupImportIn,
    WecomApiLoginReq,
    WecomApiLoginStatusOut,
    WecomApiProfileOut,
    WecomApiRoomMembersOut,
    WecomApiRoomMessagesOut,
    WecomApiRoomsOut,
    WecomApiStatusOut,
    WxGroupCreateIn,
    WxGroupDetail,
    WxGroupListResponse,
    WxGroupOut,
    WxGroupSyncResult,
    WxGroupUpdateIn,
    WxMessageCreateIn,
    WxMessageListResponse,
    WxMessageOut,
    WxStatusOut,
)
from app.services import wecomapi_service, wxwork_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wx", tags=["wx"])


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


def _to_group_out(group, bind=None) -> WxGroupOut:
    return WxGroupOut(
        id=group.id,
        chat_id=group.chat_id,
        name=group.name,
        owner=group.owner,
        owner_name=group.owner_name,
        member_count=group.member_count,
        webhook_url=group.webhook_url,
        wecomapi_room_id=group.wecomapi_room_id,
        external_count=group.external_count,
        status=group.status,
        last_sync_at=group.last_sync_at,
        patient_id=bind.patient_id if bind else None,
        patient_name=bind.patient_name if bind else None,
    )


def _to_message_out(row) -> WxMessageOut:
    return WxMessageOut(
        id=row.id,
        group_id=row.group_id,
        group_name=row.group_name,
        patient_id=row.patient_id,
        patient_name=row.patient_name,
        msg_type=row.msg_type,
        title=row.title,
        content=row.content,
        url=row.url,
        picurl=row.picurl,
        sender=row.sender,
        status=row.status,
        fail_reason=row.fail_reason,
        sent_at=row.sent_at,
        created_at=row.created_at,
    )


def _get_group_or_404(db: Session, group_id: int):
    group = wxwork_service.get_group(db, group_id)
    if group is None:
        raise NotFoundError("群不存在")
    return group


def _get_message_or_404(db: Session, hospital_id: int, message_id: int):
    row = db.get(WxMessage, message_id)
    if row is None or row.hospital_id != hospital_id:
        raise NotFoundError("推送记录不存在")
    return row


@router.get("/status", response_model=WxStatusOut)
async def get_wx_status(
    user: RbacUser = Depends(require_permission("wx_group:view")),
    db: Session = Depends(get_db),
) -> WxStatusOut:
    """企业微信集成状态（不含凭证信息），前端据此展示配置引导。"""
    return WxStatusOut(**wxwork_service.integration_status(db))


@router.get("/groups", response_model=WxGroupListResponse)
async def list_wx_groups(
    keyword: str | None = Query(None, description="按群名或群主模糊搜索"),
    bound: bool | None = Query(None, description="是否已绑定患者"),
    status: int | None = Query(None, description="跟进状态：0正常/1离职待继承/2继承中/3继承完成"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user: RbacUser = Depends(require_permission("wx_group:view")),
    db: Session = Depends(get_db),
) -> WxGroupListResponse:
    """群列表（分页 + 筛选），附带当前医院绑定的患者。"""
    rows, total, binds = wxwork_service.list_groups(
        db,
        hospital_id=_hospital_id(user),
        keyword=keyword,
        bound=bound,
        status=status,
        page=page,
        page_size=page_size,
    )
    return WxGroupListResponse(
        items=[_to_group_out(row, binds.get(row.id)) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/groups/sync", response_model=WxGroupSyncResult)
async def sync_wx_groups(
    user: RbacUser = Depends(require_permission("wx_group:sync")),
    db: Session = Depends(get_db),
) -> WxGroupSyncResult:
    """同步群：优先从 wecomapi 平台全量同步；未配置第三方通道时回退企微官方。

    已有同步任务在执行时返回 409。
    """
    async with wxwork_service.SyncLock():
        if settings.wx_wecomapi_configured:
            return await wxwork_service.sync_groups_from_wecomapi(db)
        return await wxwork_service.sync_groups(db)


@router.post("/groups", response_model=WxGroupOut)
async def create_wx_group(
    payload: WxGroupCreateIn,
    user: RbacUser = Depends(require_permission("wx_group:create")),
    db: Session = Depends(get_db),
) -> WxGroupOut:
    """手动添加群（无企微凭证时维护群列表的入口，建议配置 Webhook 或 wecomapi 以支持推送）。"""
    group = wxwork_service.create_manual_group(
        db,
        name=payload.name,
        owner=payload.owner,
        owner_name=payload.owner_name,
        member_count=payload.member_count,
        webhook_url=payload.webhook_url,
        wecomapi_room_id=payload.wecomapi_room_id,
    )
    return _to_group_out(group)


@router.put("/groups/{group_id}", response_model=WxGroupDetail)
async def update_wx_group(
    group_id: int,
    payload: WxGroupUpdateIn,
    user: RbacUser = Depends(require_permission("wx_group:update")),
    db: Session = Depends(get_db),
) -> WxGroupDetail:
    """更新群信息（群名 / 群主 / 成员数 / Webhook / wecomapi roomId，传 None 清空对应通道）。"""
    group = _get_group_or_404(db, group_id)
    wxwork_service.update_group(
        db,
        group,
        name=payload.name,
        owner=payload.owner,
        owner_name=payload.owner_name,
        member_count=payload.member_count,
        webhook_url=payload.webhook_url,
        wecomapi_room_id=payload.wecomapi_room_id,
    )
    bind = db.scalar(
        select(WxGroupPatient).where(
            WxGroupPatient.hospital_id == _hospital_id(user),
            WxGroupPatient.group_id == group.id,
        )
    )
    out = _to_group_out(group, bind)
    return WxGroupDetail(
        **out.model_dump(),
        bind_at=bind.bind_at if bind else None,
        bind_by=bind.bind_by if bind else None,
    )


@router.get("/groups/{group_id}", response_model=WxGroupDetail)
async def get_wx_group(
    group_id: int,
    user: RbacUser = Depends(require_permission("wx_group:view")),
    db: Session = Depends(get_db),
) -> WxGroupDetail:
    """群详情（含绑定患者与绑定时间）。"""
    group = _get_group_or_404(db, group_id)
    bind = db.scalar(
        select(WxGroupPatient).where(
            WxGroupPatient.hospital_id == _hospital_id(user),
            WxGroupPatient.group_id == group.id,
        )
    )
    out = _to_group_out(group, bind)
    return WxGroupDetail(
        **out.model_dump(),
        bind_at=bind.bind_at if bind else None,
        bind_by=bind.bind_by if bind else None,
    )


@router.put("/groups/{group_id}/patient", response_model=WxGroupOut)
async def bind_wx_group_patient(
    group_id: int,
    payload: PatientBindIn,
    user: RbacUser = Depends(require_permission("wx_group:update")),
    db: Session = Depends(get_db),
) -> WxGroupOut:
    """绑定或换绑群对应的患者（同一医院内每群一位）。"""
    group = _get_group_or_404(db, group_id)
    bind = wxwork_service.bind_patient(
        db,
        hospital_id=_hospital_id(user),
        group=group,
        patient_id=payload.patient_id.strip(),
        patient_name=payload.patient_name.strip(),
        operator_id=user.id,
    )
    return _to_group_out(group, bind)


@router.delete("/groups/{group_id}/patient", response_model=dict)
async def unbind_wx_group_patient(
    group_id: int,
    user: RbacUser = Depends(require_permission("wx_group:update")),
    db: Session = Depends(get_db),
) -> dict:
    """解绑群对应的患者。"""
    wxwork_service.unbind_patient(db, hospital_id=_hospital_id(user), group_id=group_id)
    return {"ok": True}


@router.get("/messages", response_model=WxMessageListResponse)
async def list_wx_messages(
    group_id: int | None = Query(None, description="按群过滤"),
    status: str | None = Query(None, description="pending / sent / fail"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user: RbacUser = Depends(require_permission("wx_group:view")),
    db: Session = Depends(get_db),
) -> WxMessageListResponse:
    """推送记录列表（分页 + 筛选）。"""
    rows, total = wxwork_service.list_messages(
        db,
        hospital_id=_hospital_id(user),
        group_id=group_id,
        status=status,
        page=page,
        page_size=page_size,
    )
    return WxMessageListResponse(
        items=[_to_message_out(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/messages", response_model=WxMessageOut)
async def send_wx_message(
    payload: WxMessageCreateIn,
    user: RbacUser = Depends(require_permission("wx_group:send")),
    db: Session = Depends(get_db),
) -> WxMessageOut:
    """向单个群推送消息。

    通道按优先级自动选择：
    1. 群配置 Webhook → 直接推送（内部群机器人，即时成功）；
    2. 群配置 wecomapi roomId 且通道就绪 → 第三方通道直推（可发外部群，试点）；
    3. 否则 → 企业群发（提交成功不代表已发送，需群主在企业微信客户端确认）。

    业务失败（企微拒绝该群等）时记录状态为 fail，HTTP 仍返回 200。
    """
    group = _get_group_or_404(db, payload.group_id)
    _validate_payload(payload)
    record = await wxwork_service.send_group_message(
        db,
        hospital_id=_hospital_id(user),
        group=group,
        payload=payload,
        operator_id=user.id,
    )
    return _to_message_out(record)


@router.post("/messages/{message_id}/refresh", response_model=WxMessageOut)
async def refresh_wx_message_status(
    message_id: int,
    user: RbacUser = Depends(require_permission("wx_group:refresh")),
    db: Session = Depends(get_db),
) -> WxMessageOut:
    """刷新单条推送的发送结果（回查企微群发状态）。"""
    record = _get_message_or_404(db, _hospital_id(user), message_id)
    await wxwork_service.refresh_message_status(db, record)
    db.commit()
    db.refresh(record)
    return _to_message_out(record)


def _validate_payload(payload: WxMessageCreateIn) -> None:
    """校验消息内容：文本与链接卡片各有所需字段。"""
    if payload.msg_type == "link":
        if not payload.title or not payload.url:
            raise WxBadRequest("链接卡片消息的标题与链接不能为空")
        return
    if payload.msg_type != "text":
        raise WxBadRequest("消息类型仅支持 text 或 link")
    if not (payload.content or "").strip():
        raise WxBadRequest("文本消息内容不能为空")


# ==================== wecomapi 第三方通道（试点） ====================


@router.get("/wecomapi/status", response_model=WecomApiStatusOut)
async def get_wecomapi_status(
    user: RbacUser = Depends(require_permission("wx_wecomapi:view")),
) -> WecomApiStatusOut:
    """wecomapi 通道状态（不含任何凭证，前端据此展示设备登录引导）。"""
    token_set = bool(settings.wx_wecomapi_token.get_secret_value().strip())
    if not settings.wx_wecomapi_configured:
        return WecomApiStatusOut(configured=False, token_set=token_set)
    try:
        info = await wecomapi_service.check_online()
    except wecomapi_service.WecomApiError as exc:
        return WecomApiStatusOut(configured=True, token_set=True, message=str(exc))
    return WecomApiStatusOut(configured=True, token_set=True, **info)


@router.post("/wecomapi/device/qrcode", response_model=WecomApiDeviceOut)
async def create_wecomapi_device(
    user: RbacUser = Depends(require_permission("wx_wecomapi:manage")),
) -> WecomApiDeviceOut:
    """创建设备并返回登录二维码。

    - 配置中已有 guid：直接用已配置设备（仅用于重新扫码排查）；
    - 未配置 guid：创建新设备（返回临时 guid，登录成功后写入 .env 持久化）。
    """
    try:
        if settings.wx_wecomapi_guid.strip():
            guid = settings.wx_wecomapi_guid.strip()
            configured = True
        else:
            guid = await wecomapi_service.create_device()
            configured = False
        qrcode = await wecomapi_service.get_login_qrcode(guid)
    except wecomapi_service.WecomApiError as exc:
        raise WxBadRequest(str(exc)) from exc
    message = (
        "使用企业微信扫码登录该设备"
        if not configured
        else "该设备已在配置中，可重新扫码登录（仅用于排查）"
    )
    return WecomApiDeviceOut(guid=guid, qrcode_base64=qrcode, configured=configured, message=message)


@router.post("/wecomapi/login/status", response_model=WecomApiLoginStatusOut)
async def check_wecomapi_login(
    payload: WecomApiLoginReq,
    user: RbacUser = Depends(require_permission("wx_wecomapi:manage")),
) -> WecomApiLoginStatusOut:
    """轮询扫码登录状态；登录成功后把 guid 写入 .env 并重启后端即可生效。"""
    try:
        info = await wecomapi_service.check_login_status(payload.guid)
    except wecomapi_service.WecomApiError as exc:
        raise WxBadRequest(str(exc)) from exc
    return WecomApiLoginStatusOut(guid=payload.guid, **info)


@router.get("/wecomapi/rooms", response_model=WecomApiRoomsOut)
async def list_wecomapi_rooms(
    next_start_index: int = Query(0, ge=0),
    user: RbacUser = Depends(require_permission("wx_wecomapi:view")),
) -> WecomApiRoomsOut:
    """拉取 wecomapi 平台群列表（用于把 roomId 导入到本地群配置）。"""
    try:
        data = await wecomapi_service.list_rooms(next_start_index=next_start_index)
    except wecomapi_service.WecomApiError as exc:
        raise WxBadRequest(str(exc)) from exc
    return WecomApiRoomsOut(**data)


@router.get("/wecomapi/rooms/{room_id}/messages", response_model=WecomApiRoomMessagesOut)
async def list_wecomapi_room_messages(
    room_id: str,
    limit: int = Query(100, ge=10, le=200, description="每页消息条数"),
    user: RbacUser = Depends(require_permission("wx_wecomapi:view")),
) -> WecomApiRoomMessagesOut:
    """拉取 wecomapi 平台指定群的聊天记录（试点）。

    平台仅提供全局消息流，后端翻页同步后按 fromRoomId 过滤出该群消息。
    """
    try:
        data = await wecomapi_service.list_room_messages(room_id, limit=limit)
    except wecomapi_service.WecomApiError as exc:
        raise WxBadRequest(str(exc)) from exc
    return WecomApiRoomMessagesOut(**data)


@router.get("/wecomapi/profile", response_model=WecomApiProfileOut)
async def get_wecomapi_profile(
    user: RbacUser = Depends(require_permission("wx_wecomapi:view")),
) -> WecomApiProfileOut:
    """查询当前登录 wecomapi 账号资料（头像、昵称）。"""
    try:
        data = await wecomapi_service.get_profile()
    except wecomapi_service.WecomApiError as exc:
        raise WxBadRequest(str(exc)) from exc
    return WecomApiProfileOut(**data)


@router.get("/wecomapi/contacts", response_model=WecomApiContactsBatchOut)
async def batch_get_wecomapi_contacts(
    user_ids: str = Query(..., description="联系人 userId，多个用英文逗号分隔"),
    user: RbacUser = Depends(require_permission("wx_wecomapi:view")),
) -> WecomApiContactsBatchOut:
    """批量获取 wecomapi 联系人详情（用于消息头像）。"""
    ids = [uid.strip() for uid in user_ids.split(",") if uid.strip()]
    if not ids:
        return WecomApiContactsBatchOut()
    try:
        items = await wecomapi_service.batch_get_contacts(ids)
    except wecomapi_service.WecomApiError as exc:
        raise WxBadRequest(str(exc)) from exc
    return WecomApiContactsBatchOut(items=items)


@router.get("/wecomapi/rooms/{room_id}/members", response_model=WecomApiRoomMembersOut)
async def list_wecomapi_room_members(
    room_id: str,
    user: RbacUser = Depends(require_permission("wx_wecomapi:view")),
) -> WecomApiRoomMembersOut:
    """获取 wecomapi 平台指定群的成员列表（昵称/头像来自联系人资料）。"""
    try:
        data = await wecomapi_service.get_room_members(room_id)
    except wecomapi_service.WecomApiError as exc:
        raise WxBadRequest(str(exc)) from exc
    return WecomApiRoomMembersOut(**data)


@router.post("/wecomapi/groups/import", response_model=WxGroupSyncResult)
async def import_wecomapi_groups(
    payload: WecomApiGroupImportIn,
    user: RbacUser = Depends(require_permission("wx_wecomapi:manage")),
    db: Session = Depends(get_db),
) -> WxGroupSyncResult:
    """把选中的 wecomapi 平台群导入到本地群列表（按 roomId upsert，不删除本地记录）。"""
    async with wxwork_service.SyncLock():
        return await wxwork_service.sync_groups_from_wecomapi(
            db,
            room_ids=None if payload.sync_all else payload.room_ids,
        )
