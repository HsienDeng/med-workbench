"""FastAPI 依赖：解析当前登录用户（Bearer Token → med_sessions → med_users）。"""
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.exceptions import AuthError, ForbiddenError
from app.models import RbacUser
from app.services import auth_service, permission_service

bearer_scheme = HTTPBearer(auto_error=False, description="登录接口返回的访问令牌")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> RbacUser:
    """校验 Authorization: Bearer <token>，成功返回当前用户，失败抛 401。"""
    if credentials is None:
        raise AuthError("未提供访问令牌", code="MED_TOKEN_MISSING")
    return auth_service.authenticate_token(db, credentials.credentials)


def require_hospital_admin(
    current_user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RbacUser:
    """仅允许医院管理员执行服务端配置变更。"""
    roles = auth_service.get_user_roles(db, current_user)
    if not any(role.role_code == "hospital_admin" for role in roles):
        raise ForbiddenError()
    return current_user


def require_permission(permission_code: str):
    """按功能权限点拦截敏感接口（返回当前用户，可在参数中继续复用）。

    权限点编码由 permission_service.PERMISSION_CATALOG 定义，
    hospital_admin 为系统超级用户恒放行。前端以登录下发的 permissions 保持一致。
    """

    def _checker(
        current_user: RbacUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> RbacUser:
        if not permission_service.user_has_permission(db, current_user, permission_code):
            raise ForbiddenError(
                f"当前账号缺少操作权限：{permission_code}",
                code="MED_PERMISSION_DENIED",
            )
        return current_user

    return _checker
