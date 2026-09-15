"""wecomapi.com 第三方企微通道（试点）。

用途：向「外部群」主动发消息。官方群机器人仅支持内部群、未认证企业无法调用
客户联系 API，故试点该非官方协议通道。

风险声明（务必知悉）：
- 该通道基于非官方协议，企业微信随时可能风控账号/群聊，甚至牵连企业主体；
- 仅建议用测试账号小范围试点，勿在生产环境直接使用真实患者数据；
- 正式上线请优先完成企业微信认证，走官方「客户群群发」链路。

接口模式（文档：https://post.wecomapi.com/llms.txt）：
POST {base_url}
Header: Content-Type: application/json, WECOM-TOKEN: <token>
Body:   {"method": "/模块/方法", "params": {...}}
成功响应: {"code": 0, "msg": "成功", "data": {...}}（checkLogin 示例返回 200）
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# 平台成功状态码（checkLogin 示例返回 200；getRoomList 等部分接口以 -1 + msg=成功 表示成功）
_SUCCESS_CODES = (0, 200, -1)

# 扫码登录状态 -> 文案
_LOGIN_STATUS_MESSAGES = {
    -1: "未认证，需扫码认证",
    0: "未认证，可免扫码认证",
    1: "已扫码，待确认",
    2: "登录成功",
    4: "用户取消认证",
    10: "已确认，需校验验证码",
}


class WecomApiError(Exception):
    """wecomapi 平台调用失败（携带平台错误码）。"""

    def __init__(self, message: str, *, code: int | None = None):
        super().__init__(message)
        self.code = code


def _require_token() -> str:
    token = settings.wx_wecomapi_token.get_secret_value().strip()
    if not token:
        raise WecomApiError("未配置 WX_WECOMAPI_TOKEN（wecomapi 管理后台获取）")
    return token


def _require_guid() -> str:
    guid = settings.wx_wecomapi_guid.strip()
    if not guid:
        raise WecomApiError("未配置 WX_WECOMAPI_GUID（需先完成扫码登录）")
    return guid


async def _call(method: str, params: dict[str, Any]) -> dict[str, Any]:
    """调用平台统一接口，返回 data 对象；失败抛 WecomApiError。"""
    token = _require_token()
    timeout = httpx.Timeout(settings.wx_http_timeout)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                settings.wx_wecomapi_base_url,
                headers={"Content-Type": "application/json", "WECOM-TOKEN": token},
                json={"method": method, "params": params},
            )
    except httpx.HTTPError as exc:
        raise WecomApiError(f"wecomapi 请求失败：{exc}") from exc

    try:
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise WecomApiError(f"wecomapi 返回非 JSON 响应（HTTP {resp.status_code}）") from exc

    code = int(data.get("code") or -1)
    msg = str(data.get("msg") or "")
    ok = code in _SUCCESS_CODES or (code == -1 and "成功" in msg)
    if not ok:
        raise WecomApiError(
            f"wecomapi 返回错误 {code}：{msg}",
            code=code,
        )
    return data.get("data") or {}


# ---------- 设备与登录 ----------


async def create_device() -> str:
    """创建设备并获取 guid。"""
    data = await _call(
        "/client/createClient",
        {
            "proxyUrl": settings.wx_wecomapi_proxy_url or "",
            "areaCode": settings.wx_wecomapi_area_code,
            "deviceName": settings.wx_wecomapi_device_name,
            "deviceType": 0,
            "clientVersion": "",
        },
    )
    guid = str(data.get("guid") or "")
    if not guid:
        raise WecomApiError("创建设备失败：接口未返回 guid")
    return guid


async def get_login_qrcode(guid: str) -> str:
    """获取登录二维码（Base64 图片数据）。"""
    data = await _call("/login/getLoginQrcode", {"guid": guid, "useCache": False})
    return str(data.get("loginQrcodeBase64Data") or "")


async def check_login_status(guid: str) -> dict[str, Any]:
    """轮询扫码登录状态。status == 2 表示登录成功。"""
    data = await _call("/login/checkLoginQrCode", {"guid": guid})
    status = int(data.get("loginQrcodeStatus") or -1)
    return {
        "status": status,
        "done": status == 2,
        "nickname": str(data.get("nickname") or ""),
        "corp_name": str(data.get("corpName") or ""),
        "message": _LOGIN_STATUS_MESSAGES.get(status, f"未知状态 {status}"),
    }


async def check_online() -> dict[str, Any]:
    """查询配置设备上的账号在线状态。"""
    data = await _call("/login/checkLogin", {"guid": _require_guid()})
    raw = int(data.get("userOnlineStatus") or 0)
    return {
        "online": raw == 2,  # 文档示例 2=在线（平台未公开枚举，按示例处理）
        "nickname": str(data.get("nickname") or ""),
        "corp_name": str(data.get("corpName") or ""),
        "message": "在线" if raw == 2 else f"离线（平台状态码 {raw}）",
    }


# ---------- 群列表（导入 roomId） ----------


async def list_rooms(next_start_index: int = 0) -> dict[str, Any]:
    """分页拉取设备可见的群列表。"""
    data = await _call(
        "/room/getRoomList",
        {"guid": _require_guid(), "nextStartIndex": next_start_index},
    )
    items = []
    for row in data.get("roomList") or []:
        items.append(
            {
                "room_id": str(row.get("roomId") or ""),
                "room_name": str(row.get("roomName") or ""),
                "member_count": int(row.get("roomMemberCount") or 0),
            }
        )
    return {
        "items": items,
        "has_more": bool(data.get("hasMore")),
        "next_start_index": int(data.get("nextStartIndex") or -1),
    }


async def list_all_rooms() -> list[dict[str, Any]]:
    """全量拉取设备可见的群列表（自动翻页拼齐）。"""
    all_items: list[dict[str, Any]] = []
    next_start_index = 0
    while True:
        data = await list_rooms(next_start_index=next_start_index)
        all_items.extend(data["items"])
        if not data["has_more"]:
            break
        next_start_index = data["next_start_index"]
        if next_start_index < 0:
            break
    return all_items


# ---------- 消息记录（同步历史消息，按群过滤） ----------


async def sync_messages(msg_seq: int = 0, limit: int = 100) -> dict[str, Any]:
    """同步历史消息分页（全局消息流）。

    返回 dict(items, has_more, next_msg_seq)；items 中每条为标准化消息，
    按 fromRoomId 过滤即可得到单个群的聊天记录。
    """
    data = await _call(
        "/msg/syncMsg",
        {"guid": _require_guid(), "msgSeq": msg_seq, "limit": limit},
    )
    items = []
    for row in data.get("syncMsgList") or []:
        msg_data = row.get("msgData") or {}
        items.append(
            {
                "msg_server_id": int(row.get("msgServerId") or row.get("seq") or 0),
                "from_room_id": str(row.get("fromRoomId") or ""),
                "is_room_notice": bool(row.get("isRoomNotice") or False),
                "sender_id": str(row.get("senderId") or ""),
                "sender_name": str(row.get("senderName") or ""),
                "content": str(msg_data.get("content") or ""),
                "msg_type": int(row.get("msgType") or 0),
                "timestamp": int(row.get("timestamp") or row.get("msgTime") or 0),
                "seq": int(row.get("seq") or 0),
            }
        )
    return {
        "items": items,
        "has_more": bool(data.get("hasMore")),
        "next_msg_seq": int(data.get("msgSeq") or data.get("travelSyncKey") or -1),
    }


async def list_room_messages(
    room_id: str, *, limit: int = 100, max_pages: int = 30
) -> dict[str, Any]:
    """拉取指定群的聊天记录（翻页同步全局消息流并按 fromRoomId 过滤）。

    max_pages 限制最大翻页数，避免全局消息过多导致长时间阻塞。
    """
    collected: list[dict[str, Any]] = []
    msg_seq = 0
    for _ in range(max_pages):
        page = await sync_messages(msg_seq=msg_seq, limit=limit)
        for item in page["items"]:
            if item["from_room_id"] == room_id:
                collected.append(item)
        if not page["has_more"] or page["next_msg_seq"] < 0:
            break
        msg_seq = page["next_msg_seq"]
    collected.sort(key=lambda m: m["timestamp"], reverse=True)
    return {"items": collected, "total": len(collected)}


async def get_profile() -> dict[str, Any]:
    """查询当前登录账号资料（头像、昵称等）。"""
    data = await _call("/user/getProfile", {"guid": _require_guid()})
    return {
        "user_id": str(data.get("userId") or ""),
        "nickname": str(data.get("nickname") or ""),
        "avatar_url": str(data.get("avatarUrl") or ""),
        "alias": str(data.get("alias") or ""),
        "mobile": str(data.get("mobile") or ""),
    }


async def batch_get_contacts(user_ids: list[str]) -> list[dict[str, Any]]:
    """批量获取联系人详情（用于消息头像）。"""
    cleaned = [uid for uid in user_ids if uid]
    if not cleaned:
        return []
    data = await _call(
        "/contact/batchGetUserinfo",
        {"guid": _require_guid(), "userIdList": cleaned},
    )
    items = []
    for row in data.get("contactList") or []:
        items.append(
            {
                "user_id": str(row.get("userId") or ""),
                "nickname": str(row.get("nickname") or ""),
                "avatar_url": str(row.get("avatarUrl") or ""),
            }
        )
    return items


async def get_room_members(room_id: str) -> dict[str, Any]:
    """获取群成员列表（群详情 + 联系人资料补充昵称/头像）。"""
    data = await _call(
        "/room/batchGetRoomDetail",
        {"guid": _require_guid(), "roomIdList": [room_id]},
    )
    room_list = data.get("roomList") or []
    if not room_list:
        return {"room_name": "", "items": []}
    room = room_list[0]
    members = room.get("memberList") or []

    contact_map: dict[str, dict[str, str]] = {}
    try:
        for contact in await batch_get_contacts([str(m.get("userId") or "") for m in members]):
            contact_map[contact["user_id"]] = contact
    except WecomApiError:
        # 联系人资料补充失败时回退到群内字段
        contact_map = {}

    items = []
    for member in members:
        user_id = str(member.get("userId") or "")
        contact = contact_map.get(user_id, {})
        items.append(
            {
                "user_id": user_id,
                "nickname": contact.get("nickname")
                or str(member.get("name") or "")
                or str(member.get("roomRemarkName") or ""),
                "avatar_url": contact.get("avatar_url", ""),
                "room_remark": str(member.get("roomRemarkName") or ""),
                # 平台返回的 isAdmin/isCreator 为 integer（0/非0），兼容字符串形式
                "is_admin": bool(
                    int(member.get("isAdmin") or 0)
                    or int(member.get("isCreator") or 0)
                ),
                "join_time": int(member.get("joinTime") or 0),
            }
        )
    return {"room_name": str(room.get("roomName") or ""), "items": items}


# ---------- 消息发送 ----------


def _assert_sent(data: dict[str, Any], kind: str) -> None:
    if int(data.get("isSendSuccess") or 0) != 1:
        raise WecomApiError(f"wecomapi 未确认{kind}发送成功：{data}")


async def send_text(guid: str, room_id: str, content: str) -> None:
    """向群发送文本消息。"""
    data = await _call(
        "/msg/sendText",
        {"guid": guid, "content": content, "toId": room_id, "isNoNeedRead": False},
    )
    _assert_sent(data, "文本")


async def send_link(
    guid: str,
    room_id: str,
    *,
    title: str,
    url: str,
    desc: str = "",
    icon_url: str = "",
) -> None:
    """向群发送链接卡片消息。"""
    data = await _call(
        "/msg/sendLink",
        {
            "guid": guid,
            "title": title,
            "linkUrl": url,
            "desc": desc,
            "iconUrl": icon_url,
            "toId": room_id,
        },
    )
    _assert_sent(data, "链接")
