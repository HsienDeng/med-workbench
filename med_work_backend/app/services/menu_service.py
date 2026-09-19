"""动态菜单查询与初始化服务。"""

from collections import defaultdict
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Menu, RbacUser, Role, RoleMenu, UserRole


MENU_SEED: tuple[dict[str, object], ...] = (
    # 顶级页面项：无 parent_key，侧边栏直接平铺、不显示分组标题
    {"key": "new-conversation", "route_key": "assistant", "title": "新会话", "icon": "PlusOutlined", "sort_order": 10},
    # AI 智能分析 + 知识中心合并为「智能诊疗中心」分组
    {"key": "clinical-hub", "title": "智能诊疗中心", "icon": "AppstoreOutlined", "sort_order": 20},
    {"key": "dashboard", "route_key": "dashboard", "title": "工作台总览", "icon": "DashboardOutlined", "parent_key": "clinical-hub", "sort_order": 20},
    {"key": "analysis", "route_key": "analysis", "title": "AI 病历分析", "icon": "FileSearchOutlined", "parent_key": "clinical-hub", "badge": "Beta", "sort_order": 21},
    {"key": "patients", "route_key": "patients", "title": "患者档案", "icon": "TeamOutlined", "parent_key": "clinical-hub", "sort_order": 22},
    {"key": "documents", "route_key": "documents", "title": "文档管理", "icon": "FolderOpenOutlined", "parent_key": "clinical-hub", "sort_order": 25},
    {"key": "entities", "route_key": "entities", "title": "医疗实体", "icon": "ApartmentOutlined", "parent_key": "clinical-hub", "phase2": True, "sort_order": 27},
    {"key": "retrieval", "route_key": "retrieval", "title": "检索测试", "icon": "ExperimentOutlined", "parent_key": "clinical-hub", "sort_order": 28},
    {"key": "system-settings", "title": "系统设置", "icon": "SettingOutlined", "collapsible": True, "sort_order": 30},
    {"key": "dictionaries", "route_key": "dictionaries", "title": "字典管理", "icon": "BookOutlined", "parent_key": "system-settings", "sort_order": 31},
    {"key": "accounts", "route_key": "accounts", "title": "账号管理", "icon": "UserOutlined", "parent_key": "system-settings", "sort_order": 32},
    {"key": "permissions", "route_key": "permissions", "title": "权限管理", "icon": "SafetyCertificateOutlined", "parent_key": "system-settings", "sort_order": 33},
    {"key": "audit", "route_key": "audit", "title": "审计日志", "icon": "FileProtectOutlined", "parent_key": "system-settings", "sort_order": 34},
)

ALL_MENU_KEYS = frozenset(item["key"] for item in MENU_SEED)

ROLE_MENU_SEED: dict[str, frozenset[str]] = {
    "hospital_admin": ALL_MENU_KEYS,
    "doctor": frozenset({
        "dashboard", "new-conversation", "clinical-hub", "analysis", "patients",
        "documents", "retrieval",
    }),
    "knowledge_admin": frozenset({
        "dashboard", "new-conversation", "clinical-hub", "documents", "retrieval",
    }),
    "auditor": frozenset({"dashboard", "new-conversation", "clinical-hub", "analysis", "audit", "retrieval"}),
}


def _flatten(menus: list[Menu]) -> list[dict[str, object]]:
    """把数据库菜单排序并递归拼装成响应树。"""
    grouped: dict[str | None, list[Menu]] = defaultdict(list)
    key_by_id = {menu.id: menu.menu_key for menu in menus}
    for menu in menus:
        grouped[key_by_id.get(menu.parent_id)].append(menu)

    result: list[dict[str, object]] = []

    def visit(items: list[Menu]) -> None:
        for menu in sorted(items, key=lambda item: (item.sort_order, item.id)):
            node: dict[str, object] = {
                "id": menu.id,
                "key": menu.menu_key,
                "parent_key": key_by_id.get(menu.parent_id),
                "route_key": menu.route_key,
                "title": menu.title,
                "icon": menu.icon_name,
                "badge": menu.badge,
                "phase2": menu.phase2,
                "collapsible": menu.menu_type == "group",
                "sort_order": menu.sort_order,
                "children": [],
            }
            result.append(node)
            visit(grouped.get(menu.menu_key, []))

    visit(grouped[None])
    return result


def get_active_role_ids(db: Session, user: RbacUser) -> list[int]:
    """读取用户当前有效且未过期的角色 ID。"""
    return [
        role_id
        for role_id, in db.execute(
            select(UserRole.role_id).where(
                UserRole.user_id == user.id,
                UserRole.hospital_id == user.hospital_id,
                UserRole.status == "active",
                or_(UserRole.expires_at.is_(None), UserRole.expires_at > datetime.now()),
            )
        ).all()
    ]


def get_user_menus(db: Session, role_ids: list[int]) -> list[dict[str, object]]:
    """返回角色可见、已启用的菜单，并按层级排序。"""
    granted_menus = list(
        db.scalars(
            select(Menu)
            .join(RoleMenu, RoleMenu.menu_id == Menu.id)
            .where(RoleMenu.role_id.in_(role_ids), Menu.status == "active")
            .distinct()
        )
    )
    all_menus_by_id = {
        menu.id: menu
        for menu in db.scalars(select(Menu).where(Menu.status == "active"))
    }
    # 对话入口对所有已登录用户开放，包括没有内置角色的用户。
    complete_menus = {
        menu.id: menu for menu in all_menus_by_id.values()
        if menu.menu_key == "new-conversation"
    }
    complete_menus.update({menu.id: menu for menu in granted_menus})
    for menu in list(complete_menus.values()):
        parent = all_menus_by_id.get(menu.parent_id)
        while parent is not None:
            complete_menus[parent.id] = parent
            parent = all_menus_by_id.get(parent.parent_id)
    return _flatten(list(complete_menus.values()))


def sync_menu_seed(db: Session) -> None:
    """同步系统菜单定义和内置角色的初始可见范围。"""
    keys = {str(item["key"]): item for item in MENU_SEED}
    menus = {menu.menu_key: menu for menu in db.scalars(select(Menu))}

    # 已从 MENU_SEED 移除的菜单直接停用，避免历史数据残留导致旧菜单仍然可见
    for menu_key, menu in menus.items():
        if menu_key not in keys and menu.status == "active":
            menu.status = "disabled"

    for definition in MENU_SEED:
        menu_key = str(definition["key"])
        menu = menus.get(menu_key)
        if menu is None:
            menu = Menu(menu_key=menu_key)
            db.add(menu)
            menus[menu_key] = menu
        parent = menus.get(str(definition.get("parent_key")))
        menu.parent_id = parent.id if parent else None
        menu.route_key = definition.get("route_key") or None
        menu.title = str(definition["title"])
        menu.icon_name = definition.get("icon") or None
        menu.badge = definition.get("badge") or None
        menu.menu_type = "group" if bool(definition.get("collapsible")) else "page"
        menu.phase2 = bool(definition.get("phase2"))
        menu.sort_order = int(definition["sort_order"])
        menu.status = "active"
        db.flush()

    role_codes = {row.role_code: row for row in db.scalars(select(Role)).all()}
    for role_code, menu_keys in ROLE_MENU_SEED.items():
        role = role_codes.get(role_code)
        if role is None:
            continue
        valid_keys = sorted(menu_keys & keys.keys())
        target_ids = {menus[menu_key].id for menu_key in valid_keys}
        current_rows = db.scalars(select(RoleMenu).where(RoleMenu.role_id == role.id)).all()
        current_by_menu_id = {row.menu_id: row for row in current_rows}
        for menu_id in target_ids - current_by_menu_id.keys():
            db.add(RoleMenu(role_id=role.id, menu_id=menu_id))
        for menu_id, row in current_by_menu_id.items():
            if menu_id not in target_ids:
                db.delete(row)

    db.commit()
