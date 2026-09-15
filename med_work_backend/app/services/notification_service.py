"""站内通知服务：统一写入入口 + 查询。

写入约定：
- create() 在业务事件发生（如 AI 分析失败）后调用；写失败仅告警不抛出，
  通知是辅助提醒，不能阻塞业务主流程；
- 通知按 user_id 定向投递（当前主要为分析发起人），hospital_id 承担租户隔离；
- resource_type / resource_id 记录关联资源（如 analysis_record / 记录ID），
  便于前端跳转回看。
"""
import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Notification, RbacUser

logger = logging.getLogger(__name__)

NOTIFICATION_TYPE_ANALYSIS_FAILED = "analysis_failed"


def create(
    db: Session,
    *,
    user: Optional[RbacUser] = None,
    hospital_id: Optional[int] = None,
    user_id: Optional[int] = None,
    type: str = "system",
    title: str,
    content: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
) -> None:
    """写入一条站内通知；任何失败仅告警，不向调用方抛出。"""
    try:
        if user is not None:
            hospital_id = hospital_id if hospital_id is not None else user.hospital_id
            user_id = user.id
        db.add(
            Notification(
                hospital_id=hospital_id,
                user_id=user_id,
                type=type,
                title=(title or "")[:128],
                content=content,
                resource_type=resource_type,
                resource_id=str(resource_id) if resource_id is not None else None,
                is_read=False,
            )
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Notification create skipped (type=%s): %s", type, exc)


def query_list(
    db: Session,
    hospital_id: int,
    user_id: int,
    *,
    page: int = 1,
    page_size: int = 20,
    unread_only: bool = False,
) -> tuple[list[Notification], int, int]:
    """分页查询当前用户通知，返回 (rows, total, unread)。"""
    base = select(Notification).where(
        Notification.hospital_id == hospital_id,
        Notification.user_id == user_id,
    )
    stmt = base
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    unread = (
        db.scalar(
            select(func.count()).select_from(
                base.where(Notification.is_read.is_(False)).subquery()
            )
        )
        or 0
    )
    rows = db.scalars(
        stmt.order_by(Notification.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return list(rows), int(total), int(unread)


def mark_read(db: Session, hospital_id: int, user_id: int, notification_id: int) -> bool:
    """标记单条通知已读（仅限本人），返回是否存在且已更新。"""
    row = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.hospital_id == hospital_id,
            Notification.user_id == user_id,
        )
    )
    if row is None:
        return False
    if not row.is_read:
        row.is_read = True
        db.commit()
    return True


def mark_all_read(db: Session, hospital_id: int, user_id: int) -> int:
    """把当前用户全部通知标记已读，返回更新的条数。"""
    rows = db.scalars(
        select(Notification).where(
            Notification.hospital_id == hospital_id,
            Notification.user_id == user_id,
            Notification.is_read.is_(False),
        )
    ).all()
    count = len(rows)
    for row in rows:
        row.is_read = True
    if count:
        db.commit()
    return count
