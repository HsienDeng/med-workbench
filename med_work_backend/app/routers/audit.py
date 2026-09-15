"""操作审计日志接口（需 audit:view 功能权限点，默认医院管理员 / 审计员持有）。

鉴权说明：审计视角与角色解耦——只要角色被授予 audit:view 即可查询
（系统内置角色 auditor / hospital_admin 默认持有，doctor / knowledge_admin 默认无）。
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_permission
from app.models import RbacUser
from app.schemas.audit import AuditLogListResponse, AuditLogItem, AuditOptionsResponse
from app.services import audit_service

router = APIRouter(prefix="/audit", tags=["audit"])

# 审计查看门槛：功能权限点 audit:view（替代早期的角色白名单判断）
_require_audit_viewer = require_permission("audit:view")


@router.get("/logs", response_model=AuditLogListResponse, summary="审计日志分页查询（管理员/审计员）")
def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str = Query("", max_length=64, description="账号 / 姓名 / 摘要关键词"),
    module: str = Query("", description="功能模块：auth/patient/medical_record/analysis"),
    action: str = Query("", description="操作：login/view/create/update/delete/parse 等"),
    result: str = Query("", description="结果：success/failure"),
    start_date: Optional[date] = Query(None, description="开始日期（含当天，YYYY-MM-DD）"),
    end_date: Optional[date] = Query(None, description="结束日期（含当天，YYYY-MM-DD）"),
    current_user: RbacUser = Depends(_require_audit_viewer),
    db: Session = Depends(get_db),
) -> AuditLogListResponse:
    hospital_id = current_user.hospital_id or 1
    rows, total = audit_service.query_logs(
        db,
        hospital_id,
        page=page,
        page_size=page_size,
        keyword=keyword,
        module=module,
        action=action,
        result=result,
        start_date=start_date,
        end_date=end_date,
    )
    return AuditLogListResponse(
        items=[AuditLogItem.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/options", response_model=AuditOptionsResponse, summary="审计筛选选项（模块/操作）")
def audit_options(
    current_user: RbacUser = Depends(_require_audit_viewer),
) -> AuditOptionsResponse:
    return AuditOptionsResponse(
        modules=list(audit_service.MODULE_OPTIONS),
        actions=list(audit_service.ACTION_OPTIONS),
    )
