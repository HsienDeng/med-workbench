"""企业微信「客户联系」服务层：外部群同步、患者绑定、企业群发。

接口事实依据企业微信开发者中心文档：
- access_token：GET  /cgi-bin/gettoken，有效期 7200s
- 群列表：      POST /cgi-bin/externalcontact/groupchat/list（cursor 分页）
- 群详情：      POST /cgi-bin/externalcontact/groupchat/get
- 企业群发：    POST /cgi-bin/externalcontact/add_msg_template（返回 msgid + fail_list）
- 发送结果：    POST /cgi-bin/externalcontact/get_groupmsg_send_result

重要平台约束：
1. 调用 add_msg_template 不会立即发送消息，需群主在企业微信客户端确认后才真正发送；
2. 每个客户群每月接收群发上限为当月天数（可在企微「群发助手-设置群发规则」调整）。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.exceptions import RedisUnavailable, WxWorkError, WxWorkNotConfigured
from app.models import WxGroup, WxGroupPatient, WxMessage
from app.redis_client import redis_delete, redis_get, redis_set, redis_setnx
from app.schemas.wx import WxGroupSyncResult
from app.services import wecomapi_service

logger = logging.getLogger(__name__)

WX_BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin"

_TOKEN_CACHE_KEY = "wx:access_token"
_TOKEN_TTL = 7000          # 企微 token 有效期 7200s，提前 200s 过期避免边界失效
_SYNC_LOCK_KEY = "wx:sync:lock"
_SYNC_LOCK_TTL = 900       # 同步最长持锁 15 分钟，防止异常退出导致锁死
_RATE_LIMIT_ERRCODE = 45009
_TOKEN_ERRCODES = {40001, 40014, 42001}

# 企微错误码 → 面向管理员的中文提示
_ERRCODE_MESSAGES: dict[int, str] = {
    40001: "企微凭证无效，请检查 WX_CORP_ID / WX_CONTACT_SECRET",
    40014: "企微 access_token 无效，请检查自建应用 secret",
    41048: "该群本月接收群发已达上限",
    42001: "企微 access_token 已过期",
    45009: "企微接口调用超过频率限制，请稍后重试",
    48002: "自建应用未开通「客户联系」权限",
    60011: "无权限访问该资源，请确认群主在应用可见范围内",
    81017: "应用可见范围过大（超 1000 人），请配置 WX_OWNER_USERIDS 缩小拉取范围",
}

# get_groupmsg_send_result 的 status 映射
_SEND_STATUS_TEXT = {
    0: "未发送",
    2: "因客户不是好友发送失败",
    3: "因其他原因发送失败",
}

# 群机器人 Webhook 错误码 → 中文提示（企微官方群机器人文档）
_WEBHOOK_ERRCODE_MESSAGES: dict[int, str] = {
    45009: "推送频率超限（每个机器人 20 条/分钟），请稍后重试",
    93000: "无效的 Webhook 地址，请在企微群「群机器人」中重新获取",
    93001: "机器人已被移出群聊，请重新添加",
    93002: "群聊已解散",
    93003: "机器人已停用，请重新启用",
    93004: "推送内容包含违规信息，请修改后重试",
}

_PROCESS_LOCK = asyncio.Lock()  # Redis 不可用时的进程内降级锁


def _ensure_configured() -> None:
    if not settings.wx_configured:
        raise WxWorkNotConfigured()


def _raise_wx_error(errcode: int, errmsg: str) -> None:
    """把企微错误码转换为面向用户的中文提示（errcode 挂在异常上供重试判定）。"""
    message = _ERRCODE_MESSAGES.get(errcode) or f"企业微信接口返回错误 {errcode}：{errmsg}"
    exc = WxWorkError(message, code="MED_WX_UPSTREAM_ERROR")
    exc.errcode = errcode
    raise exc


async def _request(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict:
    """调用企微接口并校验 errcode。"""
    timeout = httpx.Timeout(settings.wx_http_timeout)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, f"{WX_BASE_URL}{path}", params=params, json=json_body)
    except httpx.TimeoutException as exc:
        raise WxWorkError("企业微信接口请求超时", code="MED_WX_UPSTREAM_ERROR") from exc
    except httpx.HTTPError as exc:
        raise WxWorkError(f"企业微信接口不可达：{exc}", code="MED_WX_UPSTREAM_ERROR") from exc

    try:
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise WxWorkError("企业微信接口返回非 JSON 响应", code="MED_WX_UPSTREAM_ERROR") from exc

    errcode = int(data.get("errcode", -1))
    if errcode != 0:
        _raise_wx_error(errcode, str(data.get("errmsg", "")))
    return data


async def _fetch_token() -> tuple[str, int]:
    """向企微换取 access_token，返回 (token, expires_in)。"""
    data = await _request(
        "GET",
        "/gettoken",
        params={
            "corpid": settings.wx_corp_id.get_secret_value(),
            "corpsecret": settings.wx_contact_secret.get_secret_value(),
        },
    )
    token = str(data.get("access_token") or "")
    if not token:
        raise WxWorkError("企业微信未返回 access_token", code="MED_WX_UPSTREAM_ERROR")
    return token, int(data.get("expires_in") or 7200)


async def get_access_token(force_refresh: bool = False) -> str:
    """读取 access_token：优先 Redis 缓存，缺失或强制刷新时重新换取。

    Redis 不可用时降级为「每次直接向企微换取」，保证功能可用（不缓存）。
    """
    _ensure_configured()

    if not force_refresh:
        try:
            cached = redis_get(_TOKEN_CACHE_KEY)
        except RedisUnavailable:
            cached = None
        if cached:
            return cached

    token, expires_in = await _fetch_token()
    try:
        redis_set(_TOKEN_CACHE_KEY, token, min(expires_in - 200, _TOKEN_TTL))
    except RedisUnavailable:
        logger.warning("Redis 不可用，access_token 未缓存（每次调用将重新换取）")
    return token


async def _call_with_token_retry(
    method: str,
    path: str,
    json_body: dict[str, Any] | None = None,
) -> dict:
    """调用业务接口；遇 token 失效错误码时强制刷新 token 并重试一次。"""
    token = await get_access_token()
    try:
        return await _request(method, path, params={"access_token": token}, json_body=json_body)
    except WxWorkError as exc:
        if getattr(exc, "errcode", None) not in _TOKEN_ERRCODES:
            raise
        logger.info("企微 token 失效（errcode=%s），强制刷新后重试：%s", getattr(exc, "errcode"), path)
        try:
            redis_delete(_TOKEN_CACHE_KEY)
        except RedisUnavailable:
            pass
        token = await get_access_token(force_refresh=True)
        return await _request(method, path, params={"access_token": token}, json_body=json_body)


# ---------- 群同步 ----------


async def list_group_chat_ids() -> list[tuple[str, int]]:
    """拉取全部外部群的 (chat_id, status)，cursor 分页拼齐。"""
    page_size = max(1, min(settings.wx_sync_page_size, 1000))
    owner_filter = settings.wx_owner_filter
    result: list[tuple[str, int]] = []
    cursor = ""

    while True:
        body: dict[str, Any] = {"status_filter": 0, "limit": page_size}
        if owner_filter:
            body["owner_filter"] = {"userid_list": owner_filter}
        if cursor:
            body["cursor"] = cursor

        data = await _call_with_token_retry("POST", "/externalcontact/groupchat/list", body)
        for item in data.get("group_chat_list") or []:
            chat_id = str(item.get("chat_id") or "")
            if chat_id:
                result.append((chat_id, int(item.get("status") or 0)))

        cursor = str(data.get("next_cursor") or "")
        if not cursor:
            break
    return result


async def get_group_chat(chat_id: str) -> dict:
    """拉取单个群详情（need_name=1 返回成员姓名）。"""
    data = await _call_with_token_retry(
        "POST", "/externalcontact/groupchat/get", {"chat_id": chat_id, "need_name": 1}
    )
    return data.get("group_chat") or {}


def _upsert_group(db: Session, chat_id: str, status: int, detail: dict, now: datetime) -> bool:
    """写入或更新群快照，返回 True 表示本次为新增。"""
    members = detail.get("member_list") or []
    external_count = sum(1 for m in members if int(m.get("type") or 0) == 2)

    group = db.scalar(select(WxGroup).where(WxGroup.chat_id == chat_id).limit(1))
    if group is None:
        db.add(
            WxGroup(
                chat_id=chat_id,
                name=str(detail.get("name") or ""),
                owner=str(detail.get("owner") or ""),
                owner_name=str(detail.get("owner_name") or ""),
                member_count=len(members),
                external_count=external_count,
                status=status,
                last_sync_at=now,
            )
        )
        return True

    group.name = str(detail.get("name") or "")
    group.owner = str(detail.get("owner") or "")
    group.owner_name = str(detail.get("owner_name") or "")
    group.member_count = len(members)
    group.external_count = external_count
    group.status = status
    group.last_sync_at = now
    return False


async def sync_groups(db: Session) -> WxGroupSyncResult:
    """全量同步外部群到本地快照（只 upsert，不删除本地记录）。

    单个群详情失败时记录日志并跳过，不中断整体同步。
    """
    _ensure_configured()
    now = datetime.now()
    pairs = await list_group_chat_ids()

    added = updated = failed = 0
    for chat_id, status in pairs:
        try:
            detail = await get_group_chat(chat_id)
        except WxWorkError as exc:
            if "频率限制" in str(exc):
                await asyncio.sleep(1)
                try:
                    detail = await get_group_chat(chat_id)
                except WxWorkError as retry_exc:
                    logger.warning("同步群 %s 失败（重试后）：%s", chat_id, retry_exc)
                    failed += 1
                    continue
            else:
                logger.warning("同步群 %s 失败：%s", chat_id, exc)
                failed += 1
                continue

        if _upsert_group(db, chat_id, status, detail, now):
            added += 1
        else:
            updated += 1

    db.commit()
    logger.info("群同步完成：total=%d added=%d updated=%d failed=%d", len(pairs), added, updated, failed)
    return WxGroupSyncResult(
        total=len(pairs), added=added, updated=updated, failed=failed, synced_at=now
    )


def _upsert_wecomapi_group(db: Session, room: dict, now: datetime) -> bool:
    """按 wecomapi_room_id 写入或更新本地群，返回 True 表示本次为新增。"""
    room_id = str(room.get("room_id") or "").strip()
    if not room_id:
        return False
    group = db.scalar(
        select(WxGroup).where(
            WxGroup.wecomapi_room_id == room_id,
            WxGroup.deleted_at.is_(None),
        ).limit(1)
    )
    name = str(room.get("room_name") or "").strip() or room_id
    member_count = int(room.get("member_count") or 0)
    if group is None:
        db.add(
            WxGroup(
                chat_id=f"wecomapi_{room_id[:40]}",  # chat_id 唯一，room_id 一般 20 位内
                name=name,
                member_count=member_count,
                wecomapi_room_id=room_id,
                status=0,
                last_sync_at=now,
            )
        )
        return True
    group.name = name
    group.member_count = member_count
    group.last_sync_at = now
    return False


async def sync_groups_from_wecomapi(
    db: Session,
    *,
    room_ids: list[str] | None = None,
) -> WxGroupSyncResult:
    """从 wecomapi 平台全量同步群到本地快照（只 upsert，不删除本地记录）。

    room_ids 为空时同步平台全部群；传入 room_ids 时仅处理指定 roomId（获取群勾选导入）。
    """
    if not settings.wx_wecomapi_configured:
        raise WxWorkError(
            "wecomapi 通道未配置：请先完成设备扫码登录并重启后端",
            code="MED_WX_UPSTREAM_ERROR",
        )
    now = datetime.now()
    try:
        rooms = await wecomapi_service.list_all_rooms()
    except wecomapi_service.WecomApiError as exc:
        raise WxWorkError(f"拉取 wecomapi 平台群失败：{exc}", code="MED_WX_UPSTREAM_ERROR") from exc

    if room_ids:
        wanted = {rid.strip() for rid in room_ids if (rid or "").strip()}
        rooms = [r for r in rooms if str(r.get("room_id") or "").strip() in wanted]

    added = updated = failed = 0
    for room in rooms:
        try:
            if _upsert_wecomapi_group(db, room, now):
                added += 1
            else:
                updated += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("同步 wecomapi 群失败：%s（%s）", room.get("room_id"), exc)
            failed += 1

    db.commit()
    logger.info("wecomapi 群同步完成：total=%d added=%d updated=%d failed=%d", len(rooms), added, updated, failed)
    return WxGroupSyncResult(
        total=len(rooms), added=added, updated=updated, failed=failed, synced_at=now
    )


# ---------- 同步锁 ----------


class SyncLock:
    """同步锁：优先 Redis 分布式锁，Redis 不可用时降级为进程内锁。"""

    def __init__(self) -> None:
        self._degraded = False  # True 表示 Redis 不可用、已降级为进程内锁
        self._held = False

    async def __aenter__(self) -> "SyncLock":
        try:
            acquired = redis_setnx(_SYNC_LOCK_KEY, datetime.now().isoformat(), _SYNC_LOCK_TTL)
        except RedisUnavailable:
            logger.warning("Redis 不可用，群同步锁降级为进程内锁")
            self._degraded = True
            await _PROCESS_LOCK.acquire()
            self._held = True
            return self

        if not acquired:
            from app.exceptions import WxSyncInProgress

            raise WxSyncInProgress()
        self._held = True
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        if not self._held:
            return
        self._held = False
        if self._degraded:
            _PROCESS_LOCK.release()
            return
        try:
            redis_delete(_SYNC_LOCK_KEY)
        except RedisUnavailable:
            pass


# ---------- 群查询 ----------


def _bind_map(db: Session, hospital_id: int, group_ids: list[int]) -> dict[int, WxGroupPatient]:
    if not group_ids:
        return {}
    rows = db.scalars(
        select(WxGroupPatient).where(
            WxGroupPatient.hospital_id == hospital_id,
            WxGroupPatient.group_id.in_(group_ids),
        )
    ).all()
    return {row.group_id: row for row in rows}


def list_groups(
    db: Session,
    *,
    hospital_id: int,
    keyword: str | None = None,
    bound: bool | None = None,
    status: int | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[WxGroup], int, dict[int, WxGroupPatient]]:
    """群分页列表（含绑定患者）。bound 为 True/False 时筛选已绑定/未绑定。"""
    conditions = [WxGroup.deleted_at.is_(None)]
    if keyword:
        like = f"%{keyword}%"
        conditions.append(or_(WxGroup.name.like(like), WxGroup.owner_name.like(like)))
    if status is not None:
        conditions.append(WxGroup.status == status)

    bound_ids: set[int] | None = None
    if bound is not None:
        # 单列标量查询：scalars() 直接返回 int，无需（也不能）访问 .group_id
        bound_ids = set(
            db.scalars(
                select(WxGroupPatient.group_id).where(WxGroupPatient.hospital_id == hospital_id)
            ).all()
        )
        if bound:
            if not bound_ids:
                return [], 0, {}
            conditions.append(WxGroup.id.in_(bound_ids))
        elif bound_ids:
            conditions.append(WxGroup.id.notin_(bound_ids))
        # bound=False 且无任何绑定记录时无需追加条件（全部群都未绑定）

    total = int(db.scalar(select(func.count()).select_from(WxGroup).where(*conditions)) or 0)
    rows = (
        db.scalars(
            select(WxGroup)
            .where(*conditions)
            .order_by(WxGroup.last_sync_at.desc(), WxGroup.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    binds = _bind_map(db, hospital_id, [row.id for row in rows])
    return list(rows), total, binds


def get_group(db: Session, group_id: int) -> WxGroup | None:
    return db.scalar(
        select(WxGroup).where(WxGroup.id == group_id, WxGroup.deleted_at.is_(None)).limit(1)
    )


def create_manual_group(
    db: Session,
    *,
    name: str,
    owner: str = "",
    owner_name: str = "",
    member_count: int = 0,
    webhook_url: str | None = None,
    wecomapi_room_id: str | None = None,
) -> WxGroup:
    """手动添加群（无企微凭证时的本地维护入口）。

    chat_id 使用 manual_ 前缀生成的唯一值；同步逻辑按 chat_id 匹配，
    手动群天然不会被企微同步覆盖或删除。
    """
    group = WxGroup(
        chat_id=f"manual_{uuid.uuid4().hex[:16]}",
        name=name.strip(),
        owner=owner.strip(),
        owner_name=owner_name.strip(),
        member_count=max(member_count, 0),
        webhook_url=(webhook_url or "").strip() or None,
        wecomapi_room_id=(wecomapi_room_id or "").strip() or None,
        status=0,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


_UNSET = object()


def update_group(
    db: Session,
    group: WxGroup,
    *,
    name: object = _UNSET,
    owner: object = _UNSET,
    owner_name: object = _UNSET,
    member_count: object = _UNSET,
    webhook_url: object = _UNSET,
    wecomapi_room_id: object = _UNSET,
) -> WxGroup:
    """更新群信息。webhook_url / wecomapi_room_id 传 None 表示清空，不传则保持不变。"""
    if name is not _UNSET:
        group.name = str(name or "").strip()
    if owner is not _UNSET:
        group.owner = str(owner or "").strip()
    if owner_name is not _UNSET:
        group.owner_name = str(owner_name or "").strip()
    if member_count is not _UNSET:
        group.member_count = max(int(member_count or 0), 0)
    if webhook_url is not _UNSET:
        group.webhook_url = (str(webhook_url or "").strip()) or None
    if wecomapi_room_id is not _UNSET:
        group.wecomapi_room_id = (str(wecomapi_room_id or "").strip()) or None
    db.commit()
    db.refresh(group)
    return group


def bind_patient(
    db: Session, *, hospital_id: int, group: WxGroup, patient_id: str, patient_name: str, operator_id: int | None
) -> WxGroupPatient:
    """绑定或换绑患者（同一医院内每群一条记录）。"""
    row = db.scalar(
        select(WxGroupPatient)
        .where(WxGroupPatient.hospital_id == hospital_id, WxGroupPatient.group_id == group.id)
        .limit(1)
    )
    if row is None:
        row = WxGroupPatient(hospital_id=hospital_id, group_id=group.id)
        db.add(row)
    row.patient_id = patient_id
    row.patient_name = patient_name
    row.bind_by = operator_id
    row.bind_at = datetime.now()
    db.commit()
    db.refresh(row)
    return row


def unbind_patient(db: Session, *, hospital_id: int, group_id: int) -> bool:
    """解绑患者，返回是否确实删除了记录。"""
    row = db.scalar(
        select(WxGroupPatient)
        .where(WxGroupPatient.hospital_id == hospital_id, WxGroupPatient.group_id == group_id)
        .limit(1)
    )
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


# ---------- 群发推送 ----------


def _build_msg_body(payload: Any, sender: str, chat_id: str) -> dict:
    """按消息类型组装 add_msg_template 请求体。"""
    body: dict[str, Any] = {
        "chat_type": "group",
        "chat_id_list": [chat_id],
        "sender": sender,
    }
    if payload.msg_type == "link":
        link: dict[str, str] = {"title": payload.title or "", "url": payload.url or ""}
        if payload.picurl:
            link["picurl"] = payload.picurl
        if payload.desc:
            link["desc"] = payload.desc
        body["attachments"] = [{"msgtype": "link", "link": link}]
    else:
        body["text"] = {"content": payload.content or ""}
    return body


def _build_webhook_body(payload: Any) -> dict:
    """按消息类型组装群机器人 Webhook 请求体。

    Webhook 不支持 link 卡片，链接卡片降级为 markdown 链接格式。
    """
    if payload.msg_type == "link":
        title = payload.title or "点击查看"
        url = payload.url or ""
        desc = (payload.desc or "").strip()
        content = f"[{title}]({url})" + (f"\n{desc}" if desc else "")
        return {"msgtype": "markdown", "markdown": {"content": content}}
    return {"msgtype": "text", "text": {"content": payload.content or ""}}


async def _send_via_webhook(
    db: Session,
    *,
    hospital_id: int,
    group: WxGroup,
    payload: Any,
    operator_id: int | None,
) -> WxMessage:
    """通过群机器人 Webhook 直接推送（无需企微凭证，无需群主确认）。

    发送成功状态为 sent；网络/企微错误不抛异常，落库为 fail 并写入原因。
    """
    body = _build_webhook_body(payload)
    timeout = httpx.Timeout(settings.wx_http_timeout)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(group.webhook_url, json=body)
    except httpx.HTTPError as exc:
        status, reason, sent_at = "fail", f"Webhook 请求失败：{exc}", None
    else:
        try:
            data = resp.json()
        except Exception as exc:  # noqa: BLE001
            status, reason, sent_at = "fail", f"Webhook 返回非 JSON 响应：{resp.status_code}", None
        else:
            errcode = int(data.get("errcode", -1))
            if errcode == 0:
                status, reason, sent_at = "sent", None, datetime.now()
            else:
                text = _WEBHOOK_ERRCODE_MESSAGES.get(errcode)
                reason = text or f"Webhook 返回错误 {errcode}：{data.get('errmsg', '')}"
                status, sent_at = "fail", None

    record = WxMessage(
        hospital_id=hospital_id,
        group_id=group.id,
        group_name=group.name,
        msg_type=payload.msg_type,
        title=payload.title,
        content=payload.content if payload.msg_type == "text" else payload.desc,
        url=payload.url,
        picurl=payload.picurl,
        sender=group.owner or "webhook",
        operator_id=operator_id,
        status=status,
        fail_reason=reason,
        sent_at=sent_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


async def _send_via_wecomapi(
    db: Session,
    *,
    hospital_id: int,
    group: WxGroup,
    payload: Any,
    operator_id: int | None,
) -> WxMessage:
    """通过 wecomapi 第三方通道推送（可发外部群，需 Token + 设备在线）。

    发送成功状态为 sent；平台/网络错误不抛异常，落库为 fail 并写入原因。
    仅试点：非官方协议，有风控风险，勿用于真实患者数据生产。
    """
    guid = settings.wx_wecomapi_guid.strip()
    try:
        if payload.msg_type == "link":
            await wecomapi_service.send_link(
                guid,
                group.wecomapi_room_id,
                title=payload.title or "点击查看",
                url=payload.url or "",
                desc=(payload.desc or "").strip(),
                icon_url=payload.picurl or "",
            )
        else:
            await wecomapi_service.send_text(guid, group.wecomapi_room_id, payload.content or "")
        status, reason, sent_at = "sent", None, datetime.now()
    except wecomapi_service.WecomApiError as exc:
        logger.warning("wecomapi 推送群 %s 失败：%s", group.id, exc)
        status, reason, sent_at = "fail", str(exc), None

    record = WxMessage(
        hospital_id=hospital_id,
        group_id=group.id,
        group_name=group.name,
        msg_type=payload.msg_type,
        title=payload.title,
        content=payload.content if payload.msg_type == "text" else payload.desc,
        url=payload.url,
        picurl=payload.picurl,
        sender=group.owner or "wecomapi",
        operator_id=operator_id,
        status=status,
        fail_reason=reason,
        sent_at=sent_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


async def send_group_message(
    db: Session,
    *,
    hospital_id: int,
    group: WxGroup,
    payload: Any,
    operator_id: int | None,
) -> WxMessage:
    """发起推送并落库推送记录。

    推送通道按优先级自动选择：
    1. 群配置了 Webhook → 直接推送（内部群机器人，无需凭证与群主确认）；
    2. 群配置了 wecomapi roomId 且通道就绪 → 第三方通道直推（可发外部群，试点）；
    3. 否则 → 提交企业群发任务（需企微凭证，群主确认后发送）。

    业务失败不抛异常，而是把记录标记为 fail 并写入原因。
    """
    if group.webhook_url:
        return await _send_via_webhook(
            db, hospital_id=hospital_id, group=group, payload=payload, operator_id=operator_id
        )

    if group.wecomapi_room_id:
        if not settings.wx_wecomapi_configured:
            raise WxWorkError(
                "该群配置了 wecomapi 通道，但 WX_WECOMAPI_TOKEN / WX_WECOMAPI_GUID 未配置，"
                "请先在「设备登录」完成扫码并重启后端",
                code="MED_WX_UPSTREAM_ERROR",
            )
        return await _send_via_wecomapi(
            db, hospital_id=hospital_id, group=group, payload=payload, operator_id=operator_id
        )

    _ensure_configured()
    if not group.owner:
        raise WxWorkError("该群缺少群主 userid，无法确定群发发送人", code="MED_WX_UPSTREAM_ERROR")

    body = _build_msg_body(payload, group.owner, group.chat_id)
    data = await _call_with_token_retry("POST", "/externalcontact/add_msg_template", body)

    fail_list = [str(item) for item in (data.get("fail_list") or [])]
    bind = db.scalar(
        select(WxGroupPatient)
        .where(WxGroupPatient.hospital_id == hospital_id, WxGroupPatient.group_id == group.id)
        .limit(1)
    )

    record = WxMessage(
        hospital_id=hospital_id,
        group_id=group.id,
        group_name=group.name,
        patient_id=bind.patient_id if bind else None,
        patient_name=bind.patient_name if bind else None,
        msg_type=payload.msg_type,
        title=payload.title,
        content=payload.content if payload.msg_type == "text" else payload.desc,
        url=payload.url,
        picurl=payload.picurl,
        sender=group.owner,
        operator_id=operator_id,
        status="pending",
        wx_msgid=str(data.get("msgid") or "") or None,
        wx_fail_list=fail_list,
    )
    if group.chat_id in fail_list:
        record.status = "fail"
        record.fail_reason = "企业微信拒绝向该群发送（可能已达本月接收上限或群无效）"

    db.add(record)
    db.commit()
    db.refresh(record)
    return record


async def refresh_message_status(db: Session, record: WxMessage) -> bool:
    """回查单条推送的真实发送结果，返回状态是否发生变化。"""
    _ensure_configured()
    if not record.wx_msgid:
        return False

    group = get_group(db, record.group_id)
    data = await _call_with_token_retry(
        "POST",
        "/externalcontact/get_groupmsg_send_result",
        {"msgid": record.wx_msgid, "userid": record.sender, "limit": 100},
    )
    # send_list 以 chat_id 标识群；单次提交一个群，取 chat_id 匹配的那条
    chat_id = group.chat_id if group else ""
    item = next(
        (row for row in (data.get("send_list") or []) if str(row.get("chat_id") or "") == chat_id),
        None,
    )
    if item is None:
        return False
    raw_status = int(item.get("status") or 0)
    if raw_status == 1:
        new_status, reason = "sent", None
        sent_at = datetime.fromtimestamp(int(item.get("send_time") or 0)) if item.get("send_time") else datetime.now()
    elif raw_status in (2, 3):
        new_status, reason = "fail", _SEND_STATUS_TEXT.get(raw_status, "发送失败")
        sent_at = None
    else:
        return False  # 0 = 未发送，群主尚未确认

    if record.status == new_status:
        return False
    record.status = new_status
    record.fail_reason = reason
    record.sent_at = sent_at
    return True


def list_pending_messages(db: Session, *, within_hours: int = 24) -> list[WxMessage]:
    """取最近 N 小时内创建、仍为 pending 的推送记录。"""
    since = datetime.now() - timedelta(hours=within_hours)
    return list(
        db.scalars(
            select(WxMessage).where(
                WxMessage.status == "pending",
                WxMessage.created_at >= since,
                WxMessage.wx_msgid.isnot(None),
            )
        ).all()
    )


async def refresh_pending_messages(db: Session) -> int:
    """批量刷新未决推送的状态，返回状态发生变化的条数。"""
    if not settings.wx_configured:
        return 0
    changed = 0
    for record in list_pending_messages(db):
        try:
            if await refresh_message_status(db, record):
                changed += 1
        except WxWorkError as exc:
            logger.warning("刷新推送 %s 状态失败：%s", record.id, exc)
    if changed:
        db.commit()
    return changed


def list_messages(
    db: Session,
    *,
    hospital_id: int,
    group_id: int | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[WxMessage], int]:
    conditions = [WxMessage.hospital_id == hospital_id]
    if group_id is not None:
        conditions.append(WxMessage.group_id == group_id)
    if status:
        conditions.append(WxMessage.status == status)

    total = int(db.scalar(select(func.count()).select_from(WxMessage).where(*conditions)) or 0)
    rows = db.scalars(
        select(WxMessage)
        .where(*conditions)
        .order_by(WxMessage.created_at.desc(), WxMessage.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(rows), total


def integration_status(db: Session) -> dict:
    """集成状态概览（不含任何凭证信息）。"""
    last_sync_at = db.scalar(select(func.max(WxGroup.last_sync_at)))
    group_count = int(
        db.scalar(select(func.count()).select_from(WxGroup).where(WxGroup.deleted_at.is_(None))) or 0
    )
    return {
        "configured": settings.wx_configured,
        "sync_enabled": settings.wx_sync_enabled,
        "last_sync_at": last_sync_at,
        "group_count": group_count,
    }
