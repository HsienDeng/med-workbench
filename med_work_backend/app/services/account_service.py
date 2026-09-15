"""账号管理业务逻辑：平台用户（med_users）的增删改查、启停解锁、密码重置与批量导入。

账号管理是医院管理员功能，所有操作按 hospital_id 租户隔离。
写入类接口由路由层用权限点 organization:user:manage 守卫（organization:user:view 只放行查询）；
本层补充防自锁等安全规则：
- 禁止管理员对当前登录账号执行停用 / 锁定 / 删除 / 移除管理员角色（防止把系统锁死）；
- 停用 / 删除 / 重置密码后即时失效该用户会话与角色缓存。
"""
import logging
import secrets
import string
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models import Department, RbacUser, Role, UserRole
from app.schemas.account import (
    AccountBatchImportRequest,
    AccountBatchImportResult,
    AccountCreateRequest,
    AccountImportCreated,
    AccountImportFailure,
    AccountOptionsResponse,
    AccountOut,
    AccountUpdateRequest,
    DepartmentOptionOut,
    RoleBriefOut,
    RoleOptionOut,
)
from app.security import hash_password
from app.services import auth_service

logger = logging.getLogger(__name__)

MAX_PAGE_SIZE = 200

DEFAULT_ROLE_CODE = "doctor"
_PASSWORD_ALPHABET = string.ascii_letters + string.digits
# 管理员操作自身账号触发的错误码（前端可给出友好提示）
SELF_LOCKOUT_CODE = "MED_ACCOUNT_SELF_LOCKOUT"


def generate_password(length: int = 12) -> str:
    """生成随机强密码：12 位大小写字母 + 数字，至少含 1 位数字。"""
    password = "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))
    if not any(char.isdigit() for char in password):
        password = password[:-1] + secrets.choice(string.digits)
    return password


# ---------------------------------------------------------------- 查询


def list_accounts(
    db: Session,
    *,
    hospital_id: int,
    keyword: str | None = None,
    status: str | None = None,
    role_code: str | None = None,
    department_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[AccountOut], int]:
    """分页查询院内账号，返回 (账号列表, 总数)。"""
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    query = select(RbacUser).where(
        RbacUser.hospital_id == hospital_id,
        RbacUser.deleted_at.is_(None),
    )
    if keyword:
        pattern = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                RbacUser.username.like(pattern),
                RbacUser.real_name.like(pattern),
                RbacUser.employee_no.like(pattern),
            )
        )
    if status:
        query = query.where(RbacUser.status == status)
    if department_id:
        query = query.where(RbacUser.primary_department_id == department_id)
    if role_code:
        query = (
            query.join(UserRole, UserRole.user_id == RbacUser.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                UserRole.hospital_id == hospital_id,
                UserRole.status == "active",
                Role.hospital_id == hospital_id,
                Role.status == "active",
                Role.role_code == role_code,
            )
        )

    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    rows = list(
        db.scalars(
            query.order_by(RbacUser.id.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    )
    return _enrich_users(db, rows, hospital_id=hospital_id), int(total)


def get_account(db: Session, *, hospital_id: int, user_id: int) -> AccountOut:
    """按 ID 取账号详情（404 兜底）。"""
    user = _get_user(db, hospital_id=hospital_id, user_id=user_id)
    return _enrich_users(db, [user], hospital_id=hospital_id)[0]


def get_options(db: Session, *, hospital_id: int) -> AccountOptionsResponse:
    """返回账号管理页下拉数据：启用角色 + 启用科室（一二级平铺，前端可自行构树）。"""
    roles = list(
        db.scalars(
            select(Role)
            .where(
                Role.hospital_id == hospital_id,
                Role.status == "active",
                Role.deleted_at.is_(None),
            )
            .order_by(Role.id)
        )
    )
    departments = list(
        db.scalars(
            select(Department)
            .where(
                Department.hospital_id == hospital_id,
                Department.status == "active",
                Department.deleted_at.is_(None),
            )
            .order_by(Department.tree_level, Department.sort_order, Department.id)
        )
    )
    return AccountOptionsResponse(
        roles=[RoleOptionOut.model_validate(role) for role in roles],
        departments=[DepartmentOptionOut.model_validate(dept) for dept in departments],
    )


# ---------------------------------------------------------------- 写入


def create_account(
    db: Session, *, hospital_id: int, payload: AccountCreateRequest
) -> tuple[AccountOut, str]:
    """创建账号并分配角色；返回 (账号信息, 明文初始密码，仅此一次)。"""
    username = payload.username.strip()
    _assert_username_free(db, hospital_id=hospital_id, username=username)
    _assert_employee_no_free(
        db, hospital_id=hospital_id, employee_no=payload.employee_no
    )
    department = _resolve_department(
        db, hospital_id=hospital_id, department_id=payload.department_id
    )
    role_ids = payload.role_ids or []
    roles = _resolve_roles(db, hospital_id=hospital_id, role_ids=role_ids)
    if not roles and not role_ids:
        roles = _default_doctor_role(db, hospital_id=hospital_id)
        role_ids = [role.id for role in roles]

    password = payload.password or generate_password()
    user = RbacUser(
        hospital_id=hospital_id,
        username=username,
        real_name=payload.real_name.strip(),
        employee_no=payload.employee_no,
        gender=payload.gender,
        professional_title=payload.professional_title,
        primary_department_id=department.id if department else None,
        password_hash=hash_password(password),
        status=payload.status,
        must_change_password=True,
    )
    db.add(user)
    db.flush()  # 生成 user.id，供关联角色使用
    _set_user_roles(db, hospital_id=hospital_id, user=user, roles=roles)
    db.commit()
    db.refresh(user)
    return _enrich_users(db, [user], hospital_id=hospital_id)[0], password


def update_account(
    db: Session,
    *,
    hospital_id: int,
    user_id: int,
    payload: AccountUpdateRequest,
    operator_id: int,
) -> AccountOut:
    """更新账号资料与角色分配；对自身的危险变更（移除管理员角色）予以拒绝。"""
    user = _get_user(db, hospital_id=hospital_id, user_id=user_id)
    data = payload.model_dump(exclude_unset=True)

    if "real_name" in data and data["real_name"] is not None:
        user.real_name = data["real_name"].strip()
    if "employee_no" in data:
        _assert_employee_no_free(
            db, hospital_id=hospital_id, employee_no=data["employee_no"], exclude_user_id=user.id
        )
        user.employee_no = data["employee_no"]
    if "gender" in data:
        user.gender = data["gender"]
    if "professional_title" in data:
        user.professional_title = data["professional_title"]
    if "department_id" in data:
        department = _resolve_department(
            db, hospital_id=hospital_id, department_id=data["department_id"]
        )
        user.primary_department_id = department.id if department else None

    if "role_ids" in data and data["role_ids"] is not None:
        roles = _resolve_roles(db, hospital_id=hospital_id, role_ids=data["role_ids"])
        _assert_admin_removal_safe(db, user=user, operator_id=operator_id, roles=roles)
        _set_user_roles(db, hospital_id=hospital_id, user=user, roles=roles)
        auth_service.invalidate_user_roles(user.id)

    db.commit()
    db.refresh(user)
    return _enrich_users(db, [user], hospital_id=hospital_id)[0]


def set_account_status(
    db: Session, *, hospital_id: int, user_id: int, status: str, operator_id: int
) -> AccountOut:
    """变更账号状态：pending 待启用 / active 启用 / disabled 停用 / locked 手动锁定。

    active 状态本身不拒绝操作自身（幂等安全）；其余变更均禁止作用于当前登录账号。
    """
    user = _get_user(db, hospital_id=hospital_id, user_id=user_id)
    if status != "active" and user.id == operator_id:
        raise ForbiddenError(
            "不能停用或锁定当前登录账号，否则将无法继续管理系统",
            code=SELF_LOCKOUT_CODE,
        )

    if status == "active":
        user.status = "active"
        user.locked_until = None
        user.failed_login_count = 0
    elif status == "locked":
        user.status = "locked"
        user.locked_until = None  # 由状态字段兜底拦截登录，解锁后恢复
        user.failed_login_count = 0
    elif status == "disabled":
        user.status = "disabled"
        auth_service.invalidate_user_roles(user.id)
        auth_service.revoke_user_sessions(db, user_id=user.id, hospital_id=hospital_id)
    elif status == "pending":
        user.status = "pending"
        auth_service.invalidate_user_roles(user.id)
        auth_service.revoke_user_sessions(db, user_id=user.id, hospital_id=hospital_id)

    db.commit()
    db.refresh(user)
    return _enrich_users(db, [user], hospital_id=hospital_id)[0]


def reset_password(
    db: Session, *, hospital_id: int, user_id: int, password: str | None = None
) -> str:
    """重置账号密码（不传则自动生成）；重置后强制下次登录改密并撤销其全部会话。"""
    user = _get_user(db, hospital_id=hospital_id, user_id=user_id)
    plain = password or generate_password()
    user.password_hash = hash_password(plain)
    user.must_change_password = True
    user.password_changed_at = datetime.now()
    user.failed_login_count = 0
    user.locked_until = None
    auth_service.invalidate_user_roles(user.id)
    auth_service.revoke_user_sessions(db, user_id=user.id, hospital_id=hospital_id)
    db.commit()
    return plain


def delete_account(db: Session, *, hospital_id: int, user_id: int, operator_id: int) -> None:
    """软删除账号并即时撤销其会话；禁止删除当前登录账号。"""
    if user_id == operator_id:
        raise ForbiddenError(
            "不能删除当前登录账号，否则将无法继续管理系统",
            code=SELF_LOCKOUT_CODE,
        )
    user = _get_user(db, hospital_id=hospital_id, user_id=user_id)
    user.deleted_at = datetime.now()
    auth_service.invalidate_user_roles(user.id)
    auth_service.revoke_user_sessions(db, user_id=user.id, hospital_id=hospital_id)
    db.commit()


def batch_import_accounts(
    db: Session, *, hospital_id: int, payload: AccountBatchImportRequest
) -> AccountBatchImportResult:
    """按文本批量创建账号，逐行校验并返回成功数 + 失败明细。

    每行格式：`账号,姓名[,科室编码,角色编码,初始密码]`
    角色缺省为医生；科室 / 角色 / 密码留空列即可省略；
    空行与 `#` 开头行跳过；与已有账号重复的行跳过（不中断其余行）。
    """
    departments = {
        dept.department_code: dept
        for dept in db.scalars(
            select(Department).where(
                Department.hospital_id == hospital_id,
                Department.status == "active",
                Department.deleted_at.is_(None),
            )
        )
    }
    role_by_code = {
        role.role_code: role
        for role in db.scalars(
            select(Role).where(
                Role.hospital_id == hospital_id,
                Role.status == "active",
                Role.deleted_at.is_(None),
            )
        )
    }
    existing_usernames = set(
        db.scalars(select(RbacUser.username).where(RbacUser.hospital_id == hospital_id))
    )

    failures: list[AccountImportFailure] = []
    created_accounts: list[AccountImportCreated] = []
    created = 0
    seen: set[str] = set()
    for line_no, raw_line in enumerate(
        payload.text.replace("；", ";").replace("\r", "\n").replace(";", "\n").split("\n"),
        start=1,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split(",")]
        username, real_name = (parts[0], parts[1]) if len(parts) >= 2 else ("", "")
        if len(parts) < 2 or not username or not real_name:
            failures.append(AccountImportFailure(line=line_no, reason="格式应为「账号,姓名[,科室,角色,密码]」"))
            continue
        if not (2 <= len(username) <= 64):
            failures.append(AccountImportFailure(line=line_no, reason="账号长度需为 2-64 个字符"))
            continue
        if not (1 <= len(real_name) <= 64):
            failures.append(AccountImportFailure(line=line_no, reason="姓名长度需为 1-64 个字符"))
            continue
        if username in seen or username in existing_usernames:
            failures.append(AccountImportFailure(line=line_no, reason=f"账号 {username} 已存在"))
            continue

        department_code = parts[2] if len(parts) > 2 and parts[2] else None
        role_code = parts[3] if len(parts) > 3 and parts[3] else DEFAULT_ROLE_CODE
        password = parts[4] if len(parts) > 4 and parts[4] else None
        if password is not None and not (8 <= len(password) <= 128):
            failures.append(AccountImportFailure(line=line_no, reason="初始密码长度需为 8-128 位"))
            continue

        department = departments.get(department_code) if department_code else None
        if department_code and department is None:
            failures.append(AccountImportFailure(line=line_no, reason=f"科室 {department_code} 不存在或已停用"))
            continue
        role = role_by_code.get(role_code)
        if role is None:
            failures.append(AccountImportFailure(line=line_no, reason=f"角色 {role_code} 不存在或已停用"))
            continue

        plain_password = password or generate_password()
        user = RbacUser(
            hospital_id=hospital_id,
            username=username,
            real_name=real_name,
            employee_no=None,
            primary_department_id=department.id if department else None,
            password_hash=hash_password(plain_password),
            status="active",
            must_change_password=True,
        )
        db.add(user)
        db.flush()  # 生成 user.id，供关联角色使用
        db.add(
            UserRole(
                hospital_id=hospital_id,
                user_id=user.id,
                role_id=role.id,
                status="active",
            )
        )
        seen.add(username)
        created += 1
        created_accounts.append(
            AccountImportCreated(
                username=username, real_name=real_name, password=plain_password
            )
        )

    if created:
        db.commit()
    return AccountBatchImportResult(
        ok=True, created=created, accounts=created_accounts, failed=failures
    )


# ---------------------------------------------------------------- 内部工具


def _get_user(db: Session, *, hospital_id: int, user_id: int) -> RbacUser:
    user = db.scalar(
        select(RbacUser)
        .where(
            RbacUser.hospital_id == hospital_id,
            RbacUser.id == user_id,
            RbacUser.deleted_at.is_(None),
        )
        .limit(1)
    )
    if user is None:
        raise NotFoundError("账号不存在")
    return user


def _assert_username_free(db: Session, *, hospital_id: int, username: str) -> None:
    if (
        db.scalar(
            select(RbacUser.id)
            .where(RbacUser.hospital_id == hospital_id, RbacUser.username == username)
            .limit(1)
        )
        is not None
    ):
        raise ConflictError("该账号已存在", code="MED_ACCOUNT_ALREADY_EXISTS")


def _assert_employee_no_free(
    db: Session, *, hospital_id: int, employee_no: str | None, exclude_user_id: int | None = None
) -> None:
    """校验工号未被占用（含软删记录，数据库唯一索引对软删同样生效）。"""
    if not employee_no:
        return
    query = select(RbacUser.id).where(
        RbacUser.hospital_id == hospital_id,
        RbacUser.employee_no == employee_no,
    )
    if exclude_user_id is not None:
        query = query.where(RbacUser.id != exclude_user_id)
    if db.scalar(query.limit(1)) is not None:
        raise ConflictError(
            f"工号 {employee_no} 已被其他账号使用", code="MED_ACCOUNT_EMPLOYEE_NO_EXISTS"
        )


def _resolve_department(
    db: Session, *, hospital_id: int, department_id: int | None
) -> Department | None:
    """校验科室属于当前医院且启用；返回 None 表示不设主科室。"""
    if department_id is None:
        return None
    department = db.scalar(
        select(Department)
        .where(
            Department.hospital_id == hospital_id,
            Department.id == department_id,
            Department.deleted_at.is_(None),
        )
        .limit(1)
    )
    if department is None or department.status != "active":
        raise ConflictError("所选科室不存在或已停用")
    return department


def _resolve_roles(db: Session, *, hospital_id: int, role_ids: list[int]) -> list[Role]:
    """按 ID 集合取启用的医院角色；包含无效 ID 时抛 409。"""
    if not role_ids:
        return []
    roles = list(
        db.scalars(
            select(Role).where(
                Role.hospital_id == hospital_id,
                Role.id.in_(role_ids),
                Role.status == "active",
                Role.deleted_at.is_(None),
            )
        )
    )
    if len(roles) != len(set(role_ids)):
        raise ConflictError("包含不存在或已停用的角色，请刷新后重试")
    return list(roles)


def _default_doctor_role(db: Session, *, hospital_id: int) -> list[Role]:
    """新建账号未指定角色时默认分配医生角色（角色不存在则返回空）。"""
    role = db.scalar(
        select(Role).where(
            Role.hospital_id == hospital_id,
            Role.role_code == DEFAULT_ROLE_CODE,
            Role.status == "active",
            Role.deleted_at.is_(None),
        )
    )
    return [role] if role else []


def _set_user_roles(db: Session, *, hospital_id: int, user: RbacUser, roles: list[Role]) -> None:
    """覆盖式写入用户角色：先清后写（调用方随后提交事务）。"""
    existing = list(
        db.scalars(
            select(UserRole).where(
                UserRole.hospital_id == hospital_id, UserRole.user_id == user.id
            )
        )
    )
    for row in existing:
        db.delete(row)
    for role in roles:
        db.add(
            UserRole(
                hospital_id=hospital_id,
                user_id=user.id,
                role_id=role.id,
                status="active",
            )
        )
    db.flush()


def _assert_admin_removal_safe(
    db: Session, *, user: RbacUser, operator_id: int, roles: list[Role]
) -> None:
    """禁止管理员通过「编辑」把当前登录账号的管理员角色移除。"""
    if user.id != operator_id:
        return
    current_codes = {
        row.role_code
        for row in db.scalars(
            select(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(
                UserRole.hospital_id == user.hospital_id,
                UserRole.user_id == user.id,
                UserRole.status == "active",
            )
        )
    }
    if "hospital_admin" in current_codes and not any(
        role.role_code == "hospital_admin" for role in roles
    ):
        raise ForbiddenError(
            "不能移除当前登录账号的管理员角色，否则将无法继续管理系统",
            code=SELF_LOCKOUT_CODE,
        )


def _enrich_users(db: Session, users: list[RbacUser], *, hospital_id: int) -> list[AccountOut]:
    """一次查询补全用户的角色与科室信息，避免 N+1。"""
    if not users:
        return []
    user_ids = [user.id for user in users]
    dept_ids = {user.primary_department_id for user in users if user.primary_department_id}

    roles_by_user = _roles_by_users(db, hospital_id=hospital_id, user_ids=user_ids)
    departments = (
        {
            dept.id: dept
            for dept in db.scalars(select(Department).where(Department.id.in_(dept_ids)))
        }
        if dept_ids
        else {}
    )
    return [
        _build_out(
            user,
            roles_by_user.get(user.id, []),
            departments.get(user.primary_department_id) if user.primary_department_id else None,
        )
        for user in users
    ]


def _roles_by_users(
    db: Session, *, hospital_id: int, user_ids: list[int]
) -> dict[int, list[Role]]:
    """批量取各用户的启用角色（含未过期授权），保持角色按 id 排序。"""
    now = datetime.now()
    rows = db.execute(
        select(Role, UserRole.user_id)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.hospital_id == hospital_id,
            UserRole.user_id.in_(user_ids),
            UserRole.status == "active",
            Role.status == "active",
            Role.deleted_at.is_(None),
            or_(UserRole.expires_at.is_(None), UserRole.expires_at > now),
        )
        .order_by(Role.id)
    ).all()
    result: dict[int, list[Role]] = defaultdict(list)
    for role, user_id in rows:
        result[user_id].append(role)
    return result


def _build_out(user: RbacUser, roles: list[Role], department: Department | None) -> AccountOut:
    return AccountOut(
        id=user.id,
        username=user.username,
        real_name=user.real_name,
        employee_no=user.employee_no,
        gender=user.gender,
        professional_title=user.professional_title,
        primary_department_id=user.primary_department_id,
        department_name=department.department_name if department else None,
        department_code=department.department_code if department else None,
        roles=[RoleBriefOut.model_validate(role) for role in roles],
        status=user.status,
        must_change_password=user.must_change_password,
        failed_login_count=user.failed_login_count,
        locked_until=user.locked_until,
        last_login_at=user.last_login_at,
        last_login_ip=user.last_login_ip,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
