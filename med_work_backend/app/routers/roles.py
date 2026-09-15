"""角色管理 API：医院 RBAC 角色（med_roles）与菜单 / 功能权限点授权维护。

鉴权按功能权限点：organization:role:view 可查看，organization:role:manage 可维护
（默认仅医院管理员持有，hospital_admin 为超级用户恒放行）；
数据按当前用户的 hospital_id 租户隔离。
"""
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_permission
from app.models import RbacUser
from app.schemas.role import (
    RoleCreateRequest,
    RoleDetailOut,
    RoleListResponse,
    RoleMenuTreeResponse,
    RolePermissionTreeResponse,
    RoleStatusRequest,
    RoleUpdateRequest,
)
from app.services import role_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/roles", tags=["roles"])


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


@router.get("", response_model=RoleListResponse)
async def list_roles(
    keyword: str | None = Query(None, description="按角色编码 / 名称模糊搜索"),
    status: str | None = Query(None, description="角色状态：active/disabled"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user: RbacUser = Depends(require_permission("organization:role:view")),
    db: Session = Depends(get_db),
) -> RoleListResponse:
    """角色分页列表（需 organization:role:view）。"""
    items, total = role_service.list_roles(
        db,
        hospital_id=_hospital_id(user),
        keyword=keyword,
        status=status,
        page=page,
        page_size=page_size,
    )
    return RoleListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/menus", response_model=RoleMenuTreeResponse)
async def get_role_menu_tree(
    user: RbacUser = Depends(require_permission("organization:role:view")),
    db: Session = Depends(get_db),
) -> RoleMenuTreeResponse:
    """全部启用菜单组成的授权树（需 organization:role:view）。"""
    return role_service.get_menu_tree(db)


@router.get("/permission-tree", response_model=RolePermissionTreeResponse)
async def get_role_permission_tree(
    user: RbacUser = Depends(require_permission("organization:role:view")),
    db: Session = Depends(get_db),
) -> RolePermissionTreeResponse:
    """全部权限点按模块分组组成的授权树（需 organization:role:view）。"""
    return role_service.get_permission_tree(db)


@router.post("", response_model=RoleDetailOut, status_code=201)
async def create_role(
    payload: RoleCreateRequest,
    user: RbacUser = Depends(require_permission("organization:role:manage")),
    db: Session = Depends(get_db),
) -> RoleDetailOut:
    """新建自定义角色并配置菜单与权限点授权（需 organization:role:manage）。"""
    return role_service.create_role(db, hospital_id=_hospital_id(user), payload=payload)


@router.get("/{role_id}", response_model=RoleDetailOut)
async def get_role(
    role_id: int,
    user: RbacUser = Depends(require_permission("organization:role:view")),
    db: Session = Depends(get_db),
) -> RoleDetailOut:
    """角色详情（含已授权菜单与权限点 key，需 organization:role:view）。"""
    return role_service.get_role_detail(db, hospital_id=_hospital_id(user), role_id=role_id)


@router.patch("/{role_id}", response_model=RoleDetailOut)
async def update_role(
    role_id: int,
    payload: RoleUpdateRequest,
    user: RbacUser = Depends(require_permission("organization:role:manage")),
    db: Session = Depends(get_db),
) -> RoleDetailOut:
    """更新角色资料与菜单 / 权限点授权（需 organization:role:manage；系统内置角色仅可改说明）。"""
    return role_service.update_role(
        db, hospital_id=_hospital_id(user), role_id=role_id, payload=payload
    )


@router.post("/{role_id}/status", response_model=RoleDetailOut)
async def set_role_status(
    role_id: int,
    payload: RoleStatusRequest,
    user: RbacUser = Depends(require_permission("organization:role:manage")),
    db: Session = Depends(get_db),
) -> RoleDetailOut:
    """启用 / 停用自定义角色（需 organization:role:manage；停用即时收回成员权限）。"""
    return role_service.set_role_status(
        db, hospital_id=_hospital_id(user), role_id=role_id, status=payload.status
    )


@router.delete("/{role_id}", response_model=dict)
async def delete_role(
    role_id: int,
    user: RbacUser = Depends(require_permission("organization:role:manage")),
    db: Session = Depends(get_db),
) -> dict:
    """软删除自定义角色（需 organization:role:manage；仍有成员时拒绝删除）。"""
    role_service.delete_role(db, hospital_id=_hospital_id(user), role_id=role_id)
    return {"ok": True}
