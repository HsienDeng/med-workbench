"""功能权限点服务：权限目录定义、种子同步、角色授权维护与用户权限下发。

权限点（Permission）比菜单粒度更细，二者解耦：
- 菜单（med_role_menus）决定「哪些页面可见」；
- 权限点（med_role_permissions）决定「页面内哪些操作可用」，由 deps.require_permission 消费。

权限目录以本文件 PERMISSION_CATALOG 为唯一事实来源，启动时幂等同步：
- 移除目录外的存量权限点 → 停用（status=disabled），历史 RolePermission 关联同时清除；
- 新增/变化的权限点 → upsert；
- 系统内置角色按 ROLE_PERMISSION_SEED 覆盖式同步默认授权（hospital_admin 自动获得全部权限点）。

用户权限按用户缓存到 Redis（auth:user:perms:{id}，TTL 与角色缓存一致），
角色授权 / 角色分配 / 账号状态变化时由 auth_service.invalidate_user_roles 一并失效。
"""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exceptions import ConflictError
from app.models import Permission, RbacUser, Role, RolePermission
from app.redis_client import redis_delete, redis_get, redis_set
from app.services import menu_service

# Redis key 前缀与缓存 TTL（与角色缓存保持一致）
PERMS_KEY_PREFIX = "auth:user:perms:"
PERMS_CACHE_TTL = 300  # 秒

HOSPITAL_ADMIN_CODE = "hospital_admin"

# 权限点模块元信息（目录分组展示顺序）
PERMISSION_MODULES: tuple[dict[str, str], ...] = (
    {"code": "dashboard", "name": "工作台"},
    {"code": "patient", "name": "患者档案"},
    {"code": "medical_record", "name": "病历与 AI 解析"},
    {"code": "analysis", "name": "AI 分析"},
    {"code": "knowledge", "name": "知识库与文档"},
    {"code": "wx_group", "name": "企业微信群管理"},
    {"code": "dictionary", "name": "数据字典"},
    {"code": "organization", "name": "账号与角色"},
    {"code": "audit", "name": "审计日志"},
)


def _mod(code: str, name: str, resource: str, action: str, module: str, sort: int, desc: str) -> dict[str, object]:
    return {
        "code": code,
        "name": name,
        "module_code": module,
        "resource_code": resource,
        "action_code": action,
        "sort_order": sort,
        "description": desc,
    }


# 功能权限点目录：全局（不区分医院），覆盖全部功能模块
PERMISSION_CATALOG: tuple[dict[str, object], ...] = (
    # ---------- dashboard ----------
    _mod("dashboard:view", "查看工作台总览", "dashboard", "view", "dashboard", 10,
         "访问工作台总览首页与统计卡片"),
    # ---------- patient ----------
    _mod("patient:view", "查看患者档案", "patient", "view", "patient", 10,
         "查看患者列表 / 详情 / 时间线 / 分析演变"),
    _mod("patient:create", "新建患者档案", "patient", "create", "patient", 20,
         "登记新建患者档案"),
    _mod("patient:update", "编辑患者档案", "patient", "update", "patient", 30,
         "编辑患者基本信息与临床档案字段"),
    _mod("patient:import", "批量导入患者", "patient", "import", "patient", 40,
         "按批次文本导入患者档案"),
    _mod("patient:export", "导出患者报告", "patient", "export", "patient", 50,
         "导出患者档案 / 病历 / AI 分析报告（Word/PDF）"),
    _mod("patient:delete", "删除患者档案", "patient", "delete", "patient", 60,
         "删除整份患者档案（高风险，仅医院管理员）"),
    # ---------- medical_record ----------
    _mod("medical_record:view", "查看病历记录", "medical_record", "view", "medical_record", 10,
         "查看患者病历记录"),
    _mod("medical_record:create", "新建病历记录", "medical_record", "create", "medical_record", 20,
         "在数据范围内手工新建病历"),
    _mod("medical_record:update", "编辑病历记录", "medical_record", "update", "medical_record", 30,
         "编辑病历字段内容"),
    _mod("medical_record:delete", "删除病历记录", "medical_record", "delete", "medical_record", 40,
         "数据范围内软删除病历"),
    _mod("medical_record:parse", "AI 解析病历", "medical_record", "parse", "medical_record", 50,
         "上传图片 / PDF / Word 进行 AI 结构化解析"),
    _mod("medical_record:archive", "归档 AI 结论", "medical_record", "archive", "medical_record", 60,
         "把 AI 分析结论归档写入病历"),
    # ---------- analysis ----------
    _mod("analysis:view", "查看分析记录", "analysis", "view", "analysis", 10,
         "查看我的 AI 分析记录与统计"),
    _mod("analysis:create", "发起 AI 分析", "analysis", "create", "analysis", 20,
         "基于患者档案发起 AI 病历分析（消耗 AI 额度）"),
    _mod("analysis:retry", "重试失败分析", "analysis", "retry", "analysis", 30,
         "对失败的分析任务重试"),
    _mod("analysis:delete", "删除分析记录", "analysis", "delete", "analysis", 40,
         "删除我的分析记录"),
    # ---------- knowledge ----------
    _mod("knowledge:view", "查看知识库", "knowledge", "view", "knowledge", 10,
         "知识库总览 / 检索 / 文档列表"),
    _mod("knowledge_document:view", "查看知识文档", "knowledge_document", "view", "knowledge", 20,
         "查看知识文档详情与下载原文"),
    _mod("knowledge_document:upload", "上传知识文档", "knowledge_document", "upload", "knowledge", 30,
         "上传文档并解析 / 向量化入库，或从 IMA 导入"),
    _mod("knowledge_document:update", "更新文档索引", "knowledge_document", "update", "knowledge", 40,
         "重建 / 启动文档索引"),
    _mod("knowledge_document:delete", "删除知识文档", "knowledge_document", "delete", "knowledge", 50,
         "删除文档及其向量分块"),
    # ---------- wx_group ----------
    _mod("wx_group:view", "查看群与消息", "wx_group", "view", "wx_group", 10,
         "查看企微群组、群消息与随访发送记录"),
    _mod("wx_group:create", "新建群组", "wx_group", "create", "wx_group", 20,
         "在企微侧新建客户群"),
    _mod("wx_group:update", "编辑群组关系", "wx_group", "update", "wx_group", 30,
         "编辑群组 / 绑定与解绑患者"),
    _mod("wx_group:delete", "删除群组", "wx_group", "delete", "wx_group", 40,
         "解散群组或删除本地群记录"),
    _mod("wx_group:sync", "同步外部群", "wx_group", "sync", "wx_group", 50,
         "从企业微信拉取群组 / 群成员 / 群消息"),
    _mod("wx_group:send", "发送随访消息", "wx_group", "send", "wx_group", 60,
         "向群组发送随访消息并同步状态"),
    _mod("wx_group:refresh", "刷新消息状态", "wx_group", "refresh", "wx_group", 70,
         "拉取企微侧群发消息最新状态"),
    _mod("wx_wecomapi:view", "查看企微通道", "wecomapi", "view", "wx_group", 80,
         "查看企微通道配置 / 联系人 / 群成员"),
    _mod("wx_wecomapi:manage", "配置企微通道", "wecomapi", "manage", "wx_group", 90,
         "创建设备、扫码登录、导入企微群组"),
    # ---------- dictionary ----------
    _mod("dictionary:view", "查看数据字典", "dictionary", "view", "dictionary", 10,
         "查看字典与字典项"),
    _mod("dictionary:manage", "维护数据字典", "dictionary", "manage", "dictionary", 20,
         "新建 / 编辑 / 删除字典与字典项"),
    # ---------- organization ----------
    _mod("organization:user:view", "查看账号", "user", "view", "organization", 10,
         "查看账号列表 / 详情 / 管理页下拉数据"),
    _mod("organization:user:manage", "管理账号", "user", "manage", "organization", 20,
         "新建 / 编辑 / 删除 / 启停账号、批量导入、重置密码"),
    _mod("organization:role:view", "查看角色授权", "role", "view", "organization", 30,
         "查看角色列表 / 详情 / 菜单与权限点授权"),
    _mod("organization:role:manage", "管理角色授权", "role", "manage", "organization", 40,
         "新建 / 编辑 / 停用角色，配置菜单与权限点授权"),
    # ---------- audit ----------
    _mod("audit:view", "查看审计日志", "audit", "view", "audit", 10,
         "查询操作审计日志与筛选选项"),
)

_ALL_CODES = frozenset(str(item["code"]) for item in PERMISSION_CATALOG)


def _perms_key(user_id: int) -> str:
    return f"{PERMS_KEY_PREFIX}{user_id}"


def invalidate_user_permissions(user_id: int) -> None:
    """清除用户权限点缓存（角色授权 / 角色分配 / 账号状态变化后调用）。"""
    redis_delete(_perms_key(user_id))


# ---------------------------------------------------------------- 用户权限

def _query_user_permission_codes(db: Session, user: RbacUser) -> list[str]:
    """按用户当前有效角色（未过期 + active）联查去重的权限点编码。"""
    role_ids = menu_service.get_active_role_ids(db, user)
    if not role_ids:
        return []
    # 说明：MySQL 严格模式下 DISTINCT 与 ORDER BY 非选择列冲突，
    # 因此把排序列一并选出，再只取权限编码（顺序保持稳定，便于前端展示一致）
    rows = db.execute(
        select(Permission.permission_code, Permission.sort_order, Permission.id)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(
            RolePermission.role_id.in_(role_ids),
            Permission.status == "active",
        )
        .distinct()
        .order_by(Permission.sort_order, Permission.id)
    ).all()
    return [row[0] for row in rows]


def get_user_permission_codes(db: Session, user: RbacUser) -> list[str]:
    """查询用户权限点编码集合，结果缓存到 Redis（TTL 5 分钟）。"""
    key = _perms_key(user.id)
    cached = redis_get(key)
    if cached is not None:
        try:
            value = json.loads(cached)
            if isinstance(value, list):
                return [str(item) for item in value]
        except (ValueError, TypeError):
            pass
    codes = _query_user_permission_codes(db, user)
    try:
        redis_set(key, json.dumps(codes), PERMS_CACHE_TTL)
    except Exception:  # noqa: BLE001 - 缓存写失败不阻断主流程
        pass
    return codes


def user_has_permission(db: Session, user: RbacUser, permission_code: str) -> bool:
    """用户是否拥有某权限点：hospital_admin 恒放行，其余按授权集合判断。

    医院管理员是系统兜底（新上线的权限点也即刻放行）；角色信息走 Redis 缓存。
    """
    from app.services import auth_service

    roles = auth_service.get_user_roles(db, user)
    if any(role.role_code == HOSPITAL_ADMIN_CODE for role in roles):
        return True
    return permission_code in set(get_user_permission_codes(db, user))


# ---------------------------------------------------------------- 角色授权

def _permission_map(db: Session) -> dict[str, Permission]:
    return {p.permission_code: p for p in db.scalars(select(Permission)).all()}


def get_role_permission_codes(db: Session, *, role_id: int) -> list[str]:
    """按目录顺序返回角色已授权的权限点编码列表。"""
    return list(
        db.scalars(
            select(Permission.permission_code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role_id)
            .order_by(Permission.sort_order, Permission.id)
        )
    )


def resolve_permissions(db: Session, permission_codes: list[str]) -> list[Permission]:
    """按编码集合取启用的权限点（去重保序）；包含无效 / 已停用编码时抛 409。"""
    codes = list(dict.fromkeys(permission_codes))
    if not codes:
        return []
    perms = list(
        db.scalars(select(Permission).where(Permission.status == "active", Permission.permission_code.in_(codes)))
    )
    if len(perms) != len(codes):
        granted = {p.permission_code for p in perms}
        missing = sorted(set(codes) - granted)
        raise ConflictError(f"包含不存在或已停用的权限点：{', '.join(missing)}")
    by_code = {p.permission_code: p for p in perms}
    return [by_code[code] for code in codes]


def set_role_permissions(
    db: Session, *, role_id: int, hospital_id: int, permission_codes: list[str]
) -> None:
    """覆盖式写入角色权限点授权：先清后写（调用方随后提交事务）。"""
    current_rows = list(db.scalars(select(RolePermission).where(RolePermission.role_id == role_id)))
    current_ids = {row.permission_id for row in current_rows}
    target_ids = {p.id for p in resolve_permissions(db, permission_codes)}
    for permission_id in target_ids - current_ids:
        db.add(RolePermission(role_id=role_id, permission_id=permission_id, hospital_id=hospital_id))
    for row in current_rows:
        if row.permission_id not in target_ids:
            db.delete(row)
    db.flush()


def get_permission_tree(db: Session) -> list[dict[str, object]]:
    """返回按功能模块分组的权限点授权树（供角色授权界面勾选）。"""
    perms = list(
        db.scalars(
            select(Permission)
            .where(Permission.status == "active")
            .order_by(Permission.module_code, Permission.sort_order, Permission.id)
        )
    )
    items: list[dict[str, object]] = []
    for module in PERMISSION_MODULES:
        module_code = str(module["code"])
        children = [
            {
                "key": str(p.permission_code),
                "title": p.permission_name,
                "code": p.permission_code,
                "description": p.description,
            }
            for p in perms
            if p.module_code == module_code
        ]
        if not children:
            continue
        items.append(
            {
                "key": module_code,
                "title": str(module["name"]),
                "selectable": False,
                "children": children,
            }
        )
    return items


# ---------------------------------------------------------------- 种子同步

def sync_permission_seed(db: Session) -> None:
    """启动幂等：同步权限点目录，并覆盖式同步系统内置角色的默认授权。"""
    catalog = {str(item["code"]): item for item in PERMISSION_CATALOG}
    perms = _permission_map(db)

    # 已从目录移除的权限点直接停用，并清掉历史授权，避免残留能力继续生效
    for code, permission in perms.items():
        if code not in catalog and permission.status == "active":
            permission.status = "disabled"
            for row in db.scalars(
                select(RolePermission).where(RolePermission.permission_id == permission.id)
            ):
                db.delete(row)
    db.flush()

    for definition in PERMISSION_CATALOG:
        code = str(definition["code"])
        permission = perms.get(code)
        if permission is None:
            permission = Permission(permission_code=code)
            db.add(permission)
            perms[code] = permission
        permission.permission_name = str(definition["name"])
        permission.module_code = str(definition["module_code"])
        permission.resource_code = str(definition["resource_code"])
        permission.action_code = str(definition["action_code"])
        permission.description = str(definition.get("description") or "")
        permission.sort_order = int(definition["sort_order"])
        permission.status = "active"
        db.flush()

    _sync_default_role_permissions(db, perms)
    db.commit()


def _sync_default_role_permissions(db: Session, perms: dict[str, Permission]) -> None:
    """把系统内置角色的默认权限点授权覆盖到对应角色（自定义角色不在此列）。

    角色授权可在「权限管理」界面为自定义角色配置；系统内置角色仅回显，由本处统一维护，
    避免自定义配置在重启后被种子覆盖（menu 的 ROLE_MENU_SEED 采用同样策略）。
    """
    defaults: dict[str, frozenset[str]] = ROLE_PERMISSION_SEED
    roles = {row.role_code: row for row in db.scalars(select(Role)).all()}
    for role_code, codes in defaults.items():
        role = roles.get(role_code)
        if role is None:
            continue
        target_ids = {perms[code].id for code in codes if code in perms}
        current_rows = list(
            db.scalars(select(RolePermission).where(RolePermission.role_id == role.id))
        )
        current_ids = {row.permission_id for row in current_rows}
        for permission_id in target_ids - current_ids:
            db.add(
                RolePermission(
                    role_id=role.id, permission_id=permission_id, hospital_id=role.hospital_id
                )
            )
        for row in current_rows:
            if row.permission_id not in target_ids:
                db.delete(row)


# 系统内置角色默认授权（hospital_admin 自动获得全部权限点）
ROLE_PERMISSION_SEED: dict[str, frozenset[str]] = {
    "hospital_admin": _ALL_CODES,
    "doctor": frozenset({
        "dashboard:view",
        # 患者档案（不含删除 / 导入，整档删除为医院管理员职责）
        "patient:view", "patient:create", "patient:update", "patient:export",
        # 病历与 AI 解析
        "medical_record:view", "medical_record:create", "medical_record:update",
        "medical_record:delete", "medical_record:parse", "medical_record:archive",
        # AI 分析
        "analysis:view", "analysis:create", "analysis:retry", "analysis:delete",
        # 知识库（只读：可查看 / 检索 / 下载）
        "knowledge:view", "knowledge_document:view",
    }),
    "knowledge_admin": frozenset({
        "dashboard:view",
        "knowledge:view", "knowledge_document:view",
        "knowledge_document:upload", "knowledge_document:update",
        "knowledge_document:delete",
    }),
    "auditor": frozenset({
        "dashboard:view",
        "analysis:view", "analysis:create", "analysis:retry", "analysis:delete",
        "audit:view",
    }),
}
