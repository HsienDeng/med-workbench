"""操作审计日志服务：统一写入入口 + 查询。

写入约定：
- record() 在业务操作成功落库（或明确失败/拒绝）后调用，携带完整上下文；
- 审计写失败只告警不抛出——审计是辅助追踪手段，不能阻塞业务主流程；
- detail 只写简短摘要（建议使用患者编号等业务标识），不要携带患者姓名、
  手机号等敏感字段，避免审计库本身成为新的泄露面。

module/action 约定（保持前后端筛选一致）：
- module：auth / patient / medical_record / analysis
- action：login / logout / register / view / create / update / delete / parse
"""
import logging
from datetime import date, datetime, time
from typing import Optional

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import AuditLog, RbacUser

logger = logging.getLogger(__name__)

# 审计筛选可用的模块列表（供前端筛选下拉，与埋点值保持一致）
MODULE_OPTIONS = ("auth", "patient", "medical_record", "analysis")
ACTION_OPTIONS = ("login", "logout", "register", "view", "create", "update", "delete", "parse", "export", "archive", "retry")


def _client_ip(request: Request) -> str | None:
    return request.client.host if request and request.client else None


def _client_ua(request: Request) -> str | None:
    if not request:
        return None
    ua = request.headers.get("user-agent")
    return (ua or "")[:255] or None


def record(
    db: Session,
    *,
    request: Request | None = None,
    user: RbacUser | None = None,
    hospital_id: int | None = None,
    username: str | None = None,
    module: str,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: str | None = None,
    result: str = "success",
) -> None:
    """写入一条审计日志；任何失败仅告警，不向调用方抛出。

    已登录场景传 user 即可自动携带医院/账号快照；登录失败等匿名场景
    可显式传 hospital_id / username。
    """
    try:
        if user is not None:
            hospital_id = hospital_id if hospital_id is not None else user.hospital_id
            username = user.username
        db.add(
            AuditLog(
                hospital_id=hospital_id,
                user_id=user.id if user is not None else None,
                username=username,
                real_name=user.real_name if user is not None else None,
                ip=_client_ip(request),
                user_agent=_client_ua(request),
                module=module,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                detail=(detail or "")[:500] or None,
                result=result,
            )
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Audit record skipped (module=%s action=%s): %s", module, action, exc)


def query_logs(
    db: Session,
    hospital_id: int,
    *,
    page: int = 1,
    page_size: int = 20,
    keyword: str = "",
    module: str = "",
    action: str = "",
    result: str = "",
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> tuple[list[AuditLog], int]:
    """分页查询审计日志（仅限当前医院），返回 (rows, total)。"""
    stmt = select(AuditLog).where(AuditLog.hospital_id == hospital_id)

    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(
            or_(
                AuditLog.username.like(like),
                AuditLog.real_name.like(like),
                AuditLog.detail.like(like),
            )
        )
    if module:
        stmt = stmt.where(AuditLog.module == module)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if result:
        stmt = stmt.where(AuditLog.result == result)
    if start_date:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(start_date, time.min))
    if end_date:
        stmt = stmt.where(AuditLog.created_at <= datetime.combine(end_date, time.max))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return list(rows), int(total)
