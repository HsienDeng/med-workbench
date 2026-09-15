"""认证接口（薄 HTTP 层，业务逻辑见 services.auth_service）。

审计埋点：
- login / logout / register 均写入审计（登录失败也记录，便于追溯异常登录尝试）。
"""
from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import bearer_scheme, get_current_user
from app.exceptions import AuthError
from app.models import Hospital, RbacUser
from app.schemas.auth import AuthResponse, LoginRequest, RegisterRequest, RoleOut, UserOut
from app.schemas.menu import MenuListResponse, MenuOut
from app.services import audit_service, auth_service, menu_service, permission_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _default_hospital_id(db: Session) -> int | None:
    """取启用状态医院 ID，供登录失败等匿名审计落租户。"""
    row = db.scalar(
        select(Hospital.id)
        .where(Hospital.status == "active", Hospital.deleted_at.is_(None))
        .order_by(Hospital.id)
        .limit(1)
    )
    return int(row) if row is not None else None


def _build_auth_response(db: Session, user: RbacUser, request: Request) -> AuthResponse:
    """创建会话并组装 {token, user} 响应。"""
    token = auth_service.create_session(
        db,
        user,
        ttl_hours=settings.session_ttl_hours,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    roles = auth_service.get_user_roles(db, user)
    return AuthResponse(
        token=token,
        user=UserOut(
            id=user.id,
            username=user.username,
            real_name=user.real_name,
            status=user.status,
            roles=[
                RoleOut(role_code=r.role_code, role_name=r.role_name, data_scope=r.data_scope)
                for r in roles
            ],
            permissions=permission_service.get_user_permission_codes(db, user),
        ),
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> AuthResponse:
    """账号密码登录，校验通过后签发访问令牌。"""
    try:
        user, _ = auth_service.authenticate(
            db,
            payload.account,
            payload.password,
            request.client.host if request.client else None,
        )
    except AuthError as exc:
        audit_service.record(
            db,
            request=request,
            hospital_id=_default_hospital_id(db),
            username=payload.account,
            module="auth",
            action="login",
            detail=f"登录失败：{exc.message}",
            result="failure",
        )
        raise
    response = _build_auth_response(db, user, request)
    audit_service.record(
        db,
        request=request,
        user=user,
        module="auth",
        action="login",
        detail="登录成功",
    )
    return response


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: RegisterRequest, request: Request, db: Session = Depends(get_db)
) -> AuthResponse:
    """注册新账号（默认分配医生角色）并签发访问令牌。"""
    user, _ = auth_service.register_user(db, payload.username, payload.real_name, payload.password)
    response = _build_auth_response(db, user, request)
    audit_service.record(
        db,
        request=request,
        user=user,
        module="auth",
        action="register",
        detail=f"注册新账号 {user.username}",
    )
    return response


@router.get("/me", response_model=UserOut)
def me(user: RbacUser = Depends(get_current_user), db: Session = Depends(get_db)) -> UserOut:
    """当前登录用户信息（含角色），可用于前端校验令牌有效性。"""
    roles = auth_service.get_user_roles(db, user)
    return UserOut(
        id=user.id,
        username=user.username,
        real_name=user.real_name,
        status=user.status,
        roles=[
            RoleOut(role_code=r.role_code, role_name=r.role_name, data_scope=r.data_scope)
            for r in roles
        ],
        permissions=permission_service.get_user_permission_codes(db, user),
    )


@router.post("/logout")
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
    db: Session = Depends(get_db),
) -> dict:
    """登出：撤销当前会话令牌。"""
    if credentials is None:
        raise AuthError("未提供访问令牌")
    user: RbacUser | None = None
    try:
        user = auth_service.authenticate_token(db, credentials.credentials)
    except AuthError:
        pass
    auth_service.revoke_session(db, credentials.credentials)
    audit_service.record(
        db,
        request=request,
        user=user,
        module="auth",
        action="logout",
        detail="登出系统",
    )
    return {"ok": True}


@router.get("/menus", response_model=MenuListResponse)
def get_current_user_menus(
    user: RbacUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> MenuListResponse:
    """返回当前登录用户可访问的动态菜单。"""
    role_ids = menu_service.get_active_role_ids(db, user)
    menus = menu_service.get_user_menus(db, role_ids)
    return MenuListResponse(items=[MenuOut.model_validate(item) for item in menus])
