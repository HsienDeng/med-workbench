"""站内通知请求 / 响应模型。"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class NotificationItem(BaseModel):
    """单条站内通知。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    title: str
    content: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    is_read: bool = False
    created_at: datetime


class NotificationListResponse(BaseModel):
    """通知分页列表（含未读数）。"""

    items: list[NotificationItem]
    total: int
    unread: int
    page: int
    page_size: int


class NotificationReadAllResponse(BaseModel):
    """全部标为已读结果。"""

    ok: bool = True
    updated: int = 0
