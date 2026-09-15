"""站内通知接口（登录用户查自己的通知）。

鉴权说明：任何登录用户均可访问，接口按当前用户隔离
（hospital_id + user_id），只能看到 / 操作自己的通知。
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.exceptions import NotFoundError
from app.models import RbacUser
from app.schemas.notification import (
    NotificationItem,
    NotificationListResponse,
    NotificationReadAllResponse,
)
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse, summary="通知列表（分页 + 未读数）")
def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    unread_only: bool = Query(False, description="仅返回未读通知"),
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    hospital_id = current_user.hospital_id or 1
    rows, total, unread = notification_service.query_list(
        db,
        hospital_id,
        current_user.id,
        page=page,
        page_size=page_size,
        unread_only=unread_only,
    )
    return NotificationListResponse(
        items=[NotificationItem.model_validate(row) for row in rows],
        total=total,
        unread=unread,
        page=page,
        page_size=page_size,
    )


@router.patch("/{notification_id}/read", summary="标记单条通知已读")
def mark_notification_read(
    notification_id: int,
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    hospital_id = current_user.hospital_id or 1
    ok = notification_service.mark_read(db, hospital_id, current_user.id, notification_id)
    if not ok:
        raise NotFoundError("通知不存在")
    return {"ok": True}


@router.post("/read-all", response_model=NotificationReadAllResponse, summary="全部标记已读")
def mark_all_notifications_read(
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationReadAllResponse:
    hospital_id = current_user.hospital_id or 1
    updated = notification_service.mark_all_read(db, hospital_id, current_user.id)
    return NotificationReadAllResponse(ok=True, updated=updated)
