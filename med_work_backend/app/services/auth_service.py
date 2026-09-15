"""认证业务逻辑：RBAC 登录校验、账号注册、会话管理。

会话（token）以 Redis 作为认证查询主路径、数据库作为持久化来源：
- 登录：Redis 可写后提交数据库会话记录
- 校验：Redis 命中直接返回用户；未命中回源 DB 并回填 Redis
- 登出：DB 撤销 + Redis 删除
- Redis 连接异常时直接拒绝请求，不静默降级。
"""
import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.exceptions import AuthError, ConflictError
from app.models import Hospital, RbacUser, Role, UserRole, UserSession
from app.redis_client import redis_delete, redis_get, redis_set
from app.security import hash_password, verify_password
from app.services import permission_service

logger = logging.getLogger(__name__)

# 新注册账号默认分配的角色编码
DEFAULT_ROLE_CODE = "doctor"
# 连续登录失败锁定阈值与锁定时长
MAX_FAILED_LOGINS = 5
LOCK_DURATION = timedelta(minutes=15)

# Redis key 前缀与用户角色缓存 TTL
TOKEN_KEY_PREFIX = "auth:token:"
ROLES_KEY_PREFIX = "auth:user:roles:"
ROLES_CACHE_TTL = 300  # 秒


def _token_key(token_hash: str) -> str:
    return f"{TOKEN_KEY_PREFIX}{token_hash}"


def _roles_key(user_id: int) -> str:
    return f"{ROLES_KEY_PREFIX}{user_id}"


def _redis_get(key: str) -> str | None:
    return redis_get(key)


def _redis_set(key: str, value: str, ttl: int) -> None:
    redis_set(key, value, ttl)


def _redis_delete(key: str) -> None:
    redis_delete(key)


def _role_to_dict(role: Role) -> dict:
    return {"role_code": role.role_code, "role_name": role.role_name, "data_scope": role.data_scope}


def _role_from_dict(data: dict) -> Role:
    return Role(role_code=data["role_code"], role_name=data["role_name"], data_scope=data["data_scope"])


def _query_user_roles(db: Session, user: RbacUser) -> list[Role]:
    """查询用户的启用角色（排除已过期授权）。"""
    now = datetime.now()
    rows = db.execute(
        select(Role)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.user_id == user.id,
            UserRole.hospital_id == user.hospital_id,
            UserRole.status == "active",
            Role.status == "active",
            or_(UserRole.expires_at.is_(None), UserRole.expires_at > now),
        )
    ).scalars().all()
    return list(rows)


def get_user_roles(db: Session, user: RbacUser) -> list[Role]:
    """查询用户启用角色，结果缓存到 Redis（TTL 5 分钟）。"""
    key = _roles_key(user.id)
    cached = _redis_get(key)
    if cached is not None:
        try:
            return [_role_from_dict(d) for d in json.loads(cached)]
        except (ValueError, KeyError, TypeError):
            pass
    roles = _query_user_roles(db, user)
    _redis_set(key, json.dumps([_role_to_dict(r) for r in roles]), ROLES_CACHE_TTL)
    return roles


def _default_hospital(db: Session) -> Hospital:
    """取启用状态的医院（当前单医院场景）。"""
    hospital = db.scalar(
        select(Hospital)
        .where(Hospital.status == "active", Hospital.deleted_at.is_(None))
        .order_by(Hospital.id)
        .limit(1)
    )
    if hospital is None:
        raise AuthError("系统尚未初始化医院信息", code="MED_SYSTEM_NOT_INITIALIZED")
    return hospital


def authenticate(
    db: Session, username: str, password: str, ip: str | None = None
) -> tuple[RbacUser, list[Role]]:
    """校验账号密码，成功返回（用户，角色列表），失败抛 AuthError。"""
    hospital = _default_hospital(db)
    user = db.scalar(
        select(RbacUser).where(
            RbacUser.hospital_id == hospital.id,
            RbacUser.username == username.strip(),
            RbacUser.deleted_at.is_(None),
        )
    )
    now = datetime.now()

    # 统一提示，避免暴露账号是否存在
    if user is None:
        raise AuthError("账号或密码错误", code="MED_CREDENTIALS_INVALID")

    # 锁定状态优先于普通校验：管理员手动锁定（status=locked）或登录失败自动锁定（locked_until）
    if user.status == "locked":
        raise AuthError("账号已被管理员锁定，请联系管理员解锁", code="MED_ACCOUNT_LOCKED")
    if user.locked_until is not None and user.locked_until > now:
        minutes = int((user.locked_until - now).total_seconds() // 60) + 1
        raise AuthError(f"账号已锁定，请 {minutes} 分钟后再试", code="MED_ACCOUNT_LOCKED")

    if user.status == "disabled":
        raise AuthError("账号已停用，请联系管理员", code="MED_ACCOUNT_DISABLED")
    if user.status == "pending":
        raise AuthError("账号待启用，请联系管理员", code="MED_ACCOUNT_PENDING")

    if not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        if user.failed_login_count >= MAX_FAILED_LOGINS:
            user.locked_until = now + LOCK_DURATION
            user.failed_login_count = 0
            db.commit()
            raise AuthError("连续登录失败次数过多，账号已锁定 15 分钟", code="MED_ACCOUNT_LOCKED")
        db.commit()
        raise AuthError("账号或密码错误", code="MED_CREDENTIALS_INVALID")

    # 登录成功：清零失败计数、记录登录信息
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    if ip:
        user.last_login_ip = ip
    db.commit()

    return user, get_user_roles(db, user)


def register_user(
    db: Session, username: str, real_name: str, password: str
) -> tuple[RbacUser, list[Role]]:
    """创建新账号（默认分配医生角色），账号重复时抛 ConflictError。"""
    hospital = _default_hospital(db)
    username = username.strip()

    existing = db.scalar(
        select(RbacUser).where(
            RbacUser.hospital_id == hospital.id,
            RbacUser.username == username,
            RbacUser.deleted_at.is_(None),
        )
    )
    if existing is not None:
        raise ConflictError("该账号已存在", code="MED_ACCOUNT_ALREADY_EXISTS")

    user = RbacUser(
        hospital_id=hospital.id,
        username=username,
        real_name=real_name.strip(),
        password_hash=hash_password(password),
        status="active",
        must_change_password=False,
    )
    db.add(user)
    db.flush()  # 生成 user.id，供关联角色使用

    role = db.scalar(
        select(Role).where(
            Role.hospital_id == hospital.id,
            Role.role_code == DEFAULT_ROLE_CODE,
            Role.status == "active",
            Role.deleted_at.is_(None),
        )
    )
    if role is not None:
        db.add(
            UserRole(
                hospital_id=hospital.id,
                user_id=user.id,
                role_id=role.id,
                status="active",
            )
        )
    db.commit()
    db.refresh(user)
    return user, get_user_roles(db, user)


# ---------------------------------------------------------------- 会话管理


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(
    db: Session,
    user: RbacUser,
    ttl_hours: int,
    ip: str | None = None,
    user_agent: str | None = None,
) -> str:
    """创建登录会话：DB 持久化 + Redis 缓存，返回明文令牌（仅此一次）。"""
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    session = UserSession(
        hospital_id=user.hospital_id,
        user_id=user.id,
        token_hash=token_hash,
        expires_at=datetime.now() + timedelta(hours=ttl_hours),
        ip=ip,
        user_agent=(user_agent or "")[:255] or None,
    )
    db.add(session)
    db.flush()
    _redis_set(_token_key(token_hash), str(user.id), int(ttl_hours * 3600))
    db.commit()
    return token


def authenticate_token(db: Session, token: str) -> RbacUser:
    """校验访问令牌：Redis 优先，miss 回源 DB 校验并回填。"""
    token_hash = _hash_token(token)
    now = datetime.now()

    # 1) Redis 命中
    cached_uid = _redis_get(_token_key(token_hash))
    if cached_uid is not None:
        try:
            user_id = int(cached_uid)
        except ValueError:
            user_id = None
        if user_id is not None:
            user = db.scalar(
                select(RbacUser).where(
                    RbacUser.id == user_id,
                    RbacUser.deleted_at.is_(None),
                )
            )
            if user is not None and user.status == "active":
                return user
            # 用户被删除/停用：清理缓存并拒绝
            _redis_delete(_token_key(token_hash))
            raise AuthError("账号不可用，请联系管理员", code="MED_ACCOUNT_DISABLED")

    # 2) Redis miss → DB 兜底校验
    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == token_hash,
            UserSession.revoked_at.is_(None),
        )
    )
    if session is None or session.expires_at <= now:
        raise AuthError("登录已过期，请重新登录", code="MED_SESSION_EXPIRED")

    user = db.scalar(
        select(RbacUser).where(
            RbacUser.id == session.user_id,
            RbacUser.hospital_id == session.hospital_id,
            RbacUser.deleted_at.is_(None),
        )
    )
    if user is None:
        raise AuthError("登录已过期，请重新登录", code="MED_SESSION_EXPIRED")
    if user.status != "active":
        raise AuthError("账号不可用，请联系管理员", code="MED_ACCOUNT_DISABLED")

    # 3) 回填 Redis（剩余有效期）
    ttl = int((session.expires_at - now).total_seconds())
    if ttl > 0:
        _redis_set(_token_key(token_hash), str(user.id), ttl)
    return user


def revoke_session(db: Session, token: str) -> bool:
    """撤销会话（登出）：DB 标记撤销 + Redis 删除，返回是否撤销成功。"""
    token_hash = _hash_token(token)
    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == token_hash)
    )
    if session is None or session.revoked_at is not None:
        _redis_delete(_token_key(token_hash))
        return False
    session.revoked_at = datetime.now()
    db.commit()
    _redis_delete(_token_key(token_hash))
    return True


def invalidate_user_roles(user_id: int) -> None:
    """清除用户角色与权限点缓存（角色分配变更或账号状态变化后调用）。"""
    _redis_delete(_roles_key(user_id))
    permission_service.invalidate_user_permissions(user_id)


def revoke_user_sessions(db: Session, user_id: int, hospital_id: int) -> int:
    """撤销指定医院内某用户的全部登录会话（改密 / 停用 / 删除后调用），返回撤销条数。"""
    sessions = list(
        db.scalars(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.hospital_id == hospital_id,
                UserSession.revoked_at.is_(None),
            )
        )
    )
    now = datetime.now()
    for session in sessions:
        session.revoked_at = now
        _redis_delete(_token_key(session.token_hash))
    if sessions:
        db.commit()
    return len(sessions)


def cleanup_expired_sessions(db: Session) -> int:
    """物理删除已过期或已撤销的会话，返回删除条数（启动时调用）。"""
    result = db.execute(
        UserSession.__table__.delete().where(
            or_(
                UserSession.expires_at <= datetime.now(),
                UserSession.revoked_at.is_not(None),
            )
        )
    )
    db.commit()
    return result.rowcount or 0
