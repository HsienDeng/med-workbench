"""认证相关请求 / 响应模型。"""
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    account: str = Field(min_length=1, max_length=64, description="登录账号（即 med_users.username）")
    password: str = Field(min_length=1, max_length=128, description="密码")


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64, description="登录账号，同一医院内唯一")
    real_name: str = Field(min_length=1, max_length=64, description="真实姓名")
    password: str = Field(min_length=8, max_length=128, description="密码（至少 8 位）")


class RoleOut(BaseModel):
    role_code: str
    role_name: str
    data_scope: str


class UserOut(BaseModel):
    id: int
    username: str
    real_name: str
    status: str
    roles: list[RoleOut] = []
    # 功能权限点编码集合（由角色授权派生，登录 / me 时下发，供前端按钮显隐）
    permissions: list[str] = []


class AuthResponse(BaseModel):
    token: str
    user: UserOut
