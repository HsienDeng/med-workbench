"""账号管理请求 / 响应模型。

账号管理面向医院管理员，操作 med_users / med_departments / med_roles / med_user_roles。
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

ACCOUNT_STATUSES = ("pending", "active", "locked", "disabled")
GENDERS = ("male", "female", "unknown")


def _clean(value: str | None) -> str | None:
    """去掉首尾空白，空串归一为 None。"""
    if value is None:
        return None
    value = value.strip()
    return value or None


class RoleBriefOut(BaseModel):
    """账号行内展示的角色摘要。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    role_code: str
    role_name: str
    data_scope: str = "self"
    is_system: bool = False


class AccountOut(BaseModel):
    """账号列表 / 详情项（roles 与 department_name 由服务层联表组装）。"""

    id: int
    username: str
    real_name: str
    employee_no: str | None = None
    gender: str | None = None
    professional_title: str | None = None
    primary_department_id: int | None = None
    department_name: str | None = None
    department_code: str | None = None
    roles: list[RoleBriefOut] = []
    status: str
    must_change_password: bool = False
    failed_login_count: int = 0
    locked_until: datetime | None = None
    last_login_at: datetime | None = None
    last_login_ip: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("employee_no", "professional_title", "department_name", "department_code", mode="before")
    @classmethod
    def _empty_to_none(cls, value: str | None) -> str | None:
        return _clean(value)


class AccountListResponse(BaseModel):
    items: list[AccountOut]
    total: int
    page: int
    page_size: int


class AccountCreateRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64, description="登录账号，同一医院内唯一")
    real_name: str = Field(..., min_length=1, max_length=64, description="真实姓名")
    employee_no: str | None = Field(None, max_length=64, description="医院工号，同一医院内唯一")
    gender: str | None = Field(None, description="male/female/unknown")
    professional_title: str | None = Field(None, max_length=64, description="职称或岗位名称")
    department_id: int | None = Field(None, ge=1, description="主科室 ID")
    role_ids: list[int] = Field(default_factory=list, description="分配的角色 ID；为空时默认分配医生角色")
    password: str | None = Field(None, min_length=8, max_length=128, description="初始密码，留空自动生成强密码")
    status: str = Field("active", description="创建后状态：pending/active")

    @field_validator("username", "real_name", mode="before")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("employee_no", "professional_title", mode="before")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("gender")
    @classmethod
    def _check_gender(cls, value: str | None) -> str | None:
        if value is not None and value not in GENDERS:
            raise ValueError(f"性别必须为 {'/'.join(GENDERS)}")
        return value

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str) -> str:
        if value not in ("pending", "active"):
            raise ValueError("创建时状态只能为 pending 或 active")
        return value


class AccountUpdateRequest(BaseModel):
    """账号资料更新：所有字段可选；employee_no 传空串表示清空，department_id 传 null 表示不设主科室。"""

    real_name: str | None = Field(None, min_length=1, max_length=64)
    employee_no: str | None = Field(None, max_length=64)
    gender: str | None = None
    professional_title: str | None = Field(None, max_length=64)
    department_id: int | None = Field(None, ge=1)
    role_ids: list[int] | None = Field(None, description="覆盖式设置角色；null 表示不修改")

    @field_validator("real_name", mode="before")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("employee_no", "professional_title", mode="before")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("gender")
    @classmethod
    def _check_gender(cls, value: str | None) -> str | None:
        if value is not None and value not in GENDERS:
            raise ValueError(f"性别必须为 {'/'.join(GENDERS)}")
        return value


class AccountStatusRequest(BaseModel):
    """账号状态变更：pending 待启用 / active 启用 / disabled 停用 / locked 手动锁定。"""

    status: str = Field(..., description="pending/active/locked/disabled")

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str) -> str:
        if value not in ACCOUNT_STATUSES:
            raise ValueError(f"状态必须为 {'/'.join(ACCOUNT_STATUSES)}")
        return value


class AccountResetPasswordRequest(BaseModel):
    password: str | None = Field(None, min_length=8, max_length=128, description="新密码，留空自动生成")


class AccountResetPasswordResponse(BaseModel):
    ok: bool = True
    password: str = Field(..., description="明文新密码，仅此一次返回")


class AccountCreateResponse(AccountOut):
    """创建账号的返回：附带明文初始密码（仅此一次）。"""

    password: str | None = Field(None, description="明文初始密码，仅创建成功时返回一次")


class AccountBatchImportRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50000, description="每行一条：账号,姓名[,科室编码,角色编码,初始密码]")


class AccountImportFailure(BaseModel):
    line: int = Field(..., description="原文本物理行号")
    reason: str = Field(..., description="失败原因")


class AccountImportCreated(BaseModel):
    """批量导入成功的账号行（含一次性明文初始密码）。"""

    username: str
    real_name: str
    password: str = Field(..., description="明文初始密码，仅本次导入结果返回一次")


class AccountBatchImportResult(BaseModel):
    ok: bool = True
    created: int = Field(0, description="成功创建条数")
    accounts: list[AccountImportCreated] = Field(
        default_factory=list, description="成功创建的账号清单（含一次性密码）"
    )
    failed: list[AccountImportFailure] = Field(default_factory=list)


class RoleOptionOut(BaseModel):
    """角色下拉选项（仅启用状态角色）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    role_code: str
    role_name: str
    description: str | None = None
    data_scope: str = "self"
    is_system: bool = False


class DepartmentOptionOut(BaseModel):
    """科室下拉选项（仅启用状态科室）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    department_code: str
    department_name: str
    parent_id: int | None = None
    department_type: str = "clinical"
    tree_level: int = 1


class AccountOptionsResponse(BaseModel):
    """账号管理页下拉数据：可分配角色 + 可归属科室。"""

    roles: list[RoleOptionOut] = Field(default_factory=list)
    departments: list[DepartmentOptionOut] = Field(default_factory=list)
