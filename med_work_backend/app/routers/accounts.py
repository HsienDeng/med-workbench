"""账号管理 API：平台用户（med_users）的维护与状态管理。

按功能权限点拦截：organization:user:view 可查看、organization:user:manage 可维护
（默认仅医院管理员持有，hospital_admin 为超级用户恒放行）；
数据按当前用户的 hospital_id 租户隔离。
"""
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_permission
from app.models import RbacUser
from app.schemas.account import (
    AccountBatchImportRequest,
    AccountBatchImportResult,
    AccountCreateRequest,
    AccountCreateResponse,
    AccountListResponse,
    AccountOptionsResponse,
    AccountOut,
    AccountResetPasswordRequest,
    AccountResetPasswordResponse,
    AccountStatusRequest,
    AccountUpdateRequest,
)
from app.services import account_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


@router.get("", response_model=AccountListResponse)
async def list_accounts(
    keyword: str | None = Query(None, description="按账号 / 姓名 / 工号模糊搜索"),
    status: str | None = Query(None, description="账号状态：pending/active/locked/disabled"),
    role_code: str | None = Query(None, description="按角色编码过滤"),
    department_id: int | None = Query(None, description="按主科室 ID 过滤"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user: RbacUser = Depends(require_permission("organization:user:view")),
    db: Session = Depends(get_db),
) -> AccountListResponse:
    """账号分页列表（需医院管理员）。"""
    items, total = account_service.list_accounts(
        db,
        hospital_id=_hospital_id(user),
        keyword=keyword,
        status=status,
        role_code=role_code,
        department_id=department_id,
        page=page,
        page_size=page_size,
    )
    return AccountListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/options", response_model=AccountOptionsResponse)
async def get_account_options(
    user: RbacUser = Depends(require_permission("organization:user:view")),
    db: Session = Depends(get_db),
) -> AccountOptionsResponse:
    """账号管理页下拉数据：启用角色 + 启用科室（需医院管理员）。"""
    return account_service.get_options(db, hospital_id=_hospital_id(user))


@router.post("/batch-import", response_model=AccountBatchImportResult)
async def batch_import_accounts(
    payload: AccountBatchImportRequest,
    user: RbacUser = Depends(require_permission("organization:user:manage")),
    db: Session = Depends(get_db),
) -> AccountBatchImportResult:
    """按文本批量创建账号，返回成功数与失败明细（需 organization:user:manage）。"""
    return account_service.batch_import_accounts(
        db, hospital_id=_hospital_id(user), payload=payload
    )


@router.post("", response_model=AccountCreateResponse, status_code=201)
async def create_account(
    payload: AccountCreateRequest,
    user: RbacUser = Depends(require_permission("organization:user:manage")),
    db: Session = Depends(get_db),
) -> AccountCreateResponse:
    """新建账号并分配角色；返回明文初始密码（仅此一次，需 organization:user:manage）。"""
    account, password = account_service.create_account(
        db, hospital_id=_hospital_id(user), payload=payload
    )
    return AccountCreateResponse(**account.model_dump(), password=password)


@router.get("/{user_id}", response_model=AccountOut)
async def get_account(
    user_id: int,
    user: RbacUser = Depends(require_permission("organization:user:view")),
    db: Session = Depends(get_db),
) -> AccountOut:
    """账号详情（需 organization:user:view）。"""
    return account_service.get_account(db, hospital_id=_hospital_id(user), user_id=user_id)


@router.patch("/{user_id}", response_model=AccountOut)
async def update_account(
    user_id: int,
    payload: AccountUpdateRequest,
    user: RbacUser = Depends(require_permission("organization:user:manage")),
    db: Session = Depends(get_db),
) -> AccountOut:
    """更新账号资料与角色分配（需 organization:user:manage）。"""
    return account_service.update_account(
        db,
        hospital_id=_hospital_id(user),
        user_id=user_id,
        payload=payload,
        operator_id=user.id,
    )


@router.delete("/{user_id}", response_model=dict)
async def delete_account(
    user_id: int,
    user: RbacUser = Depends(require_permission("organization:user:manage")),
    db: Session = Depends(get_db),
) -> dict:
    """软删除账号并即时失效其会话（需 organization:user:manage，禁止操作自身）。"""
    account_service.delete_account(
        db, hospital_id=_hospital_id(user), user_id=user_id, operator_id=user.id
    )
    return {"ok": True}


@router.post("/{user_id}/status", response_model=AccountOut)
async def set_account_status(
    user_id: int,
    payload: AccountStatusRequest,
    user: RbacUser = Depends(require_permission("organization:user:manage")),
    db: Session = Depends(get_db),
) -> AccountOut:
    """变更账号状态：启用 / 停用 / 锁定 / 待启用（需 organization:user:manage）。"""
    return account_service.set_account_status(
        db,
        hospital_id=_hospital_id(user),
        user_id=user_id,
        status=payload.status,
        operator_id=user.id,
    )


@router.post("/{user_id}/reset-password", response_model=AccountResetPasswordResponse)
async def reset_account_password(
    user_id: int,
    payload: AccountResetPasswordRequest,
    user: RbacUser = Depends(require_permission("organization:user:manage")),
    db: Session = Depends(get_db),
) -> AccountResetPasswordResponse:
    """重置账号密码并强制下次登录改密；返回明文新密码（仅此一次，需 organization:user:manage）。"""
    password = account_service.reset_password(
        db, hospital_id=_hospital_id(user), user_id=user_id, password=payload.password
    )
    return AccountResetPasswordResponse(ok=True, password=password)
