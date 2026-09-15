"""角色管理业务逻辑：医院 RBAC 角色（med_roles）的增删改查与菜单授权维护。

角色管理是医院管理员功能，所有操作按 hospital_id 租户隔离，并补充安全规则：
- 角色编码创建后不可修改，院内唯一（含软删记录）；
- 系统内置角色（is_system）仅允许编辑说明，名称 / 编码 / 数据范围 / 状态 / 菜单授权由系统统一维护；
- hospital_admin 永远不能停用 / 删除，否则系统将无人可管；
- 停用自定义角色会将其全部成员的该角色授权一并置为停用（成员即时失去权限）；
- 角色菜单授权 / 状态 / 名称变化后清理相关成员的角色缓存。
"""
import logging
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models import Menu, RbacUser, Role, RoleMenu, UserRole
from app.schemas.role import (
    MenuTreeNode,
    PermissionTreeNode,
    RoleCreateRequest,
    RoleDetailOut,
    RoleListItem,
    RoleMenuTreeResponse,
    RolePermissionTreeResponse,
    RoleUpdateRequest,
)
from app.services import auth_service, permission_service

logger = logging.getLogger(__name__)

MAX_PAGE_SIZE = 200

HOSPITAL_ADMIN_CODE = "hospital_admin"
# 系统内置角色仅允许编辑说明字段；其余配置由系统统一维护，避免与内置种子冲突
SYSTEM_ROLE_EDIT_FIELDS = frozenset({"description"})
SYSTEM_PROTECTED_CODE = "MED_ROLE_SYSTEM_PROTECTED"


# ---------------------------------------------------------------- 查询


def list_roles(
    db: Session,
    *,
    hospital_id: int,
    keyword: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[RoleListItem], int]:
    """分页查询院内角色（含成员数），返回 (角色列表, 总数)。"""
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    query = select(Role).where(
        Role.hospital_id == hospital_id,
        Role.deleted_at.is_(None),
    )
    if keyword:
        pattern = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                Role.role_code.like(pattern),
                Role.role_name.like(pattern),
            )
        )
    if status:
        query = query.where(Role.status == status)

    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    rows = list(
        db.scalars(
            query.order_by(Role.is_system.desc(), Role.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    counts = _member_counts(db, [role.id for role in rows])
    items = [
        _build_list_item(role, member_count=counts.get(role.id, 0)) for role in rows
    ]
    return items, int(total)


def get_role_detail(db: Session, *, hospital_id: int, role_id: int) -> RoleDetailOut:
    """角色详情：附加已授权的菜单 key 与功能权限点编码（供表单回显）。"""
    role = _get_role(db, hospital_id=hospital_id, role_id=role_id)
    item = _build_list_item(role, member_count=0)
    detail = RoleDetailOut(
        **item.model_dump(),
        menu_keys=_menu_keys_of_role(db, role_id=role.id),
        permission_keys=permission_service.get_role_permission_codes(db, role_id=role.id),
    )
    detail.member_count = _member_counts(db, [role.id]).get(role.id, 0)
    return detail


def get_menu_tree(db: Session) -> RoleMenuTreeResponse:
    """返回全部启用菜单组成的授权树（含分组节点，供角色授权勾选）。"""
    menus = list(
        db.scalars(
            select(Menu).where(Menu.status == "active").order_by(Menu.sort_order, Menu.id)
        )
    )
    children: dict[int | None, list[Menu]] = defaultdict(list)
    for menu in menus:
        children[menu.parent_id].append(menu)

    def build(items: list[Menu]) -> list[MenuTreeNode]:
        nodes: list[MenuTreeNode] = []
        for menu in sorted(items, key=lambda item: (item.sort_order, item.id)):
            nodes.append(
                MenuTreeNode(
                    key=menu.menu_key,
                    title=menu.title,
                    badge=menu.badge,
                    phase2=menu.phase2,
                    children=build(children.get(menu.id, [])),
                )
            )
        return nodes

    return RoleMenuTreeResponse(items=build(children.get(None, [])))


def get_permission_tree(db: Session) -> RolePermissionTreeResponse:
    """返回按功能模块分组的权限点授权树（供角色授权界面勾选）。"""

    def build(nodes: list[dict[str, object]]) -> list[PermissionTreeNode]:
        result: list[PermissionTreeNode] = []
        for node in nodes:
            description = node.get("description")
            result.append(
                PermissionTreeNode(
                    key=str(node.get("key")),
                    title=str(node.get("title")),
                    selectable=bool(node.get("selectable", True)),
                    description=str(description) if description else None,
                    children=build(list(node.get("children") or [])),  # type: ignore[arg-type]
                )
            )
        return result

    return RolePermissionTreeResponse(items=build(permission_service.get_permission_tree(db)))


# ---------------------------------------------------------------- 写入


def create_role(db: Session, *, hospital_id: int, payload: RoleCreateRequest) -> RoleDetailOut:
    """创建自定义角色并写入菜单 / 功能权限点授权（编码 / 名称院内唯一）。"""
    role_code = payload.role_code.strip().lower()
    role_name = payload.role_name.strip()
    _assert_role_code_free(db, hospital_id=hospital_id, role_code=role_code)
    _assert_role_name_free(db, hospital_id=hospital_id, role_name=role_name)
    menus = _resolve_menus(db, menu_keys=payload.menu_keys)

    role = Role(
        hospital_id=hospital_id,
        role_code=role_code,
        role_name=role_name,
        description=payload.description,
        data_scope=payload.data_scope,
        status=payload.status,
        is_system=False,
    )
    db.add(role)
    db.flush()  # 生成 role.id，供授权写入
    _set_role_menus(db, role_id=role.id, menus=menus)
    permission_service.set_role_permissions(
        db,
        role_id=role.id,
        hospital_id=hospital_id,
        permission_codes=payload.permission_keys,
    )
    db.commit()
    return get_role_detail(db, hospital_id=hospital_id, role_id=role.id)


def update_role(
    db: Session, *, hospital_id: int, role_id: int, payload: RoleUpdateRequest
) -> RoleDetailOut:
    """更新角色资料与菜单授权；系统内置角色仅允许修改说明。"""
    role = _get_role(db, hospital_id=hospital_id, role_id=role_id)
    data = payload.model_dump(exclude_unset=True)

    if role.is_system:
        forbidden = set(data.keys()) - SYSTEM_ROLE_EDIT_FIELDS
        if forbidden:
            raise ForbiddenError(
                "系统内置角色的名称、数据范围、状态与菜单授权由系统统一管理，仅可修改说明",
                code=SYSTEM_PROTECTED_CODE,
            )
    else:
        if "role_name" in data and data["role_name"] is not None:
            _assert_role_name_free(
                db, hospital_id=hospital_id, role_name=data["role_name"], exclude_role_id=role.id
            )
            role.role_name = data["role_name"].strip()
        if "description" in data:
            role.description = data["description"]
        if "data_scope" in data and data["data_scope"] is not None:
            role.data_scope = data["data_scope"]
        if "status" in data and data["status"] is not None and data["status"] != role.status:
            _apply_status(db, role=role, status=data["status"])
        if "menu_keys" in data and data["menu_keys"] is not None:
            menus = _resolve_menus(db, menu_keys=data["menu_keys"])
            _set_role_menus(db, role_id=role.id, menus=menus)
        if "permission_keys" in data and data["permission_keys"] is not None:
            permission_service.set_role_permissions(
                db,
                role_id=role.id,
                hospital_id=role.hospital_id,
                permission_codes=data["permission_keys"],
            )

    db.commit()
    _invalidate_role_users(db, role_id=role.id)
    return get_role_detail(db, hospital_id=hospital_id, role_id=role.id)


def set_role_status(db: Session, *, hospital_id: int, role_id: int, status: str) -> RoleDetailOut:
    """启用 / 停用角色：停用即时收回其成员的角色权限，启用恢复成员授权。"""
    role = _get_role(db, hospital_id=hospital_id, role_id=role_id)
    if role.status == status:
        return get_role_detail(db, hospital_id=hospital_id, role_id=role_id)
    if role.is_system:
        raise ForbiddenError(
            "系统内置角色不能停用，其权限范围由系统统一管理",
            code=SYSTEM_PROTECTED_CODE,
        )
    _apply_status(db, role=role, status=status)
    db.commit()
    _invalidate_role_users(db, role_id=role.id)
    return get_role_detail(db, hospital_id=hospital_id, role_id=role.id)


def delete_role(db: Session, *, hospital_id: int, role_id: int) -> None:
    """软删除自定义角色；仍被成员持有的角色禁止删除。"""
    role = _get_role(db, hospital_id=hospital_id, role_id=role_id)
    if role.is_system or role.role_code == HOSPITAL_ADMIN_CODE:
        raise ForbiddenError(
            "系统内置角色（含医院管理员）不可删除",
            code=SYSTEM_PROTECTED_CODE,
        )
    member_count = _member_counts(db, [role.id]).get(role.id, 0)
    if member_count > 0:
        raise ConflictError(f"该角色仍有 {member_count} 名成员，请先在账号管理中调整其角色后再删除")
    role.deleted_at = datetime.now()
    # 解除历史遗留的停用授权关联（角色已删除，关联行失去意义）
    for row in db.scalars(select(UserRole).where(UserRole.role_id == role.id)):
        db.delete(row)
    db.commit()


# ---------------------------------------------------------------- 内部工具


def _get_role(db: Session, *, hospital_id: int, role_id: int) -> Role:
    role = db.scalar(
        select(Role)
        .where(
            Role.hospital_id == hospital_id,
            Role.id == role_id,
            Role.deleted_at.is_(None),
        )
        .limit(1)
    )
    if role is None:
        raise NotFoundError("角色不存在")
    return role


def _build_list_item(role: Role, *, member_count: int) -> RoleListItem:
    item = RoleListItem.model_validate(role)
    item.member_count = member_count
    return item


def _assert_role_code_free(db: Session, *, hospital_id: int, role_code: str) -> None:
    if (
        db.scalar(
            select(Role.id)
            .where(Role.hospital_id == hospital_id, Role.role_code == role_code)
            .limit(1)
        )
        is not None
    ):
        raise ConflictError(f"角色编码 {role_code} 已存在", code="MED_ROLE_CODE_EXISTS")


def _assert_role_name_free(
    db: Session, *, hospital_id: int, role_name: str, exclude_role_id: int | None = None
) -> None:
    query = select(Role.id).where(
        Role.hospital_id == hospital_id,
        Role.role_name == role_name,
        Role.deleted_at.is_(None),
    )
    if exclude_role_id is not None:
        query = query.where(Role.id != exclude_role_id)
    if db.scalar(query.limit(1)) is not None:
        raise ConflictError(f"角色名称「{role_name}」已存在", code="MED_ROLE_NAME_EXISTS")


def _resolve_menus(db: Session, *, menu_keys: list[str]) -> list[Menu]:
    """按 menu_key 集合取启用的菜单（去重保序）；包含无效 key 时抛 409。"""
    keys = list(dict.fromkeys(menu_keys))
    if not keys:
        return []
    menus = list(
        db.scalars(select(Menu).where(Menu.status == "active", Menu.menu_key.in_(keys)))
    )
    if len(menus) != len(keys):
        granted = {menu.menu_key for menu in menus}
        missing = sorted(set(keys) - granted)
        raise ConflictError(f"包含不存在或已停用的菜单：{', '.join(missing)}")
    by_key = {menu.menu_key: menu for menu in menus}
    return [by_key[key] for key in keys]


def _set_role_menus(db: Session, *, role_id: int, menus: list[Menu]) -> None:
    """覆盖式写入角色菜单授权：先清后写（调用方随后提交事务）。"""
    current_rows = list(db.scalars(select(RoleMenu).where(RoleMenu.role_id == role_id)))
    current_ids = {row.menu_id for row in current_rows}
    target_ids = {menu.id for menu in menus}
    for menu_id in target_ids - current_ids:
        db.add(RoleMenu(role_id=role_id, menu_id=menu_id))
    for row in current_rows:
        if row.menu_id not in target_ids:
            db.delete(row)
    db.flush()


def _menu_keys_of_role(db: Session, *, role_id: int) -> list[str]:
    """按菜单顺序返回角色已授权的 menu_key 列表。"""
    return list(
        db.scalars(
            select(Menu.menu_key)
            .join(RoleMenu, RoleMenu.menu_id == Menu.id)
            .where(RoleMenu.role_id == role_id)
            .order_by(Menu.sort_order, Menu.id)
        )
    )


def _member_counts(db: Session, role_ids: list[int]) -> dict[int, int]:
    """统计各角色的有效成员数（active 授权且账号未软删）。"""
    if not role_ids:
        return {}
    rows = db.execute(
        select(UserRole.role_id, func.count())
        .join(RbacUser, (RbacUser.id == UserRole.user_id) & (RbacUser.deleted_at.is_(None)))
        .where(
            UserRole.role_id.in_(role_ids),
            UserRole.status == "active",
        )
        .group_by(UserRole.role_id)
    ).all()
    return {role_id: int(count) for role_id, count in rows}


def _apply_status(db: Session, *, role: Role, status: str) -> None:
    """应用角色启停，并同步其成员的该角色授权状态（调用方随后提交事务）。"""
    role.status = status
    for row in db.scalars(select(UserRole).where(UserRole.role_id == role.id)):
        if status == "disabled" and row.status != "disabled":
            row.status = "disabled"
        elif status == "active" and row.status != "active":
            row.status = "active"
    db.flush()


def _invalidate_role_users(db: Session, *, role_id: int) -> None:
    """清除持有该角色用户的角色缓存（角色资料 / 授权变化后调用）。"""
    for (user_id,) in db.execute(
        select(UserRole.user_id).where(UserRole.role_id == role_id)
    ).all():
        auth_service.invalidate_user_roles(user_id)
