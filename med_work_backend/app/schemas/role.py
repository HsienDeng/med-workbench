"""权限管理（RBAC 角色）请求 / 响应模型。

角色管理面向医院管理员，操作 med_roles / med_role_menus / med_user_roles。
自定义角色可编辑编码外全部字段与菜单授权；系统内置角色（is_system）由系统统一维护。
"""
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator

DATA_SCOPES = ("self", "department", "department_tree", "hospital")
ROLE_STATUSES = ("active", "disabled")
# 角色编码规则：小写字母开头，仅含小写字母 / 数字 / 下划线
ROLE_CODE_PATTERN = r"^[a-z][a-z0-9_]{1,63}$"


def _clean(value: str | None) -> str | None:
    """去掉首尾空白，空串归一为 None。"""
    if value is None:
        return None
    value = value.strip()
    return value or None


class RoleListItem(BaseModel):
    """角色列表项（member_count 由服务层联表统计）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    role_code: str
    role_name: str
    description: str | None = None
    data_scope: str = "self"
    is_system: bool = False
    status: str = "active"
    member_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RoleListResponse(BaseModel):
    items: list[RoleListItem]
    total: int
    page: int
    page_size: int


class MenuTreeNode(BaseModel):
    """菜单授权树节点（menu_key 作 key，服务层按父子组装）。"""

    key: str
    title: str
    badge: str | None = None
    phase2: bool = False
    children: list["MenuTreeNode"] = Field(default_factory=list)


MenuTreeNode.model_rebuild()


class RoleMenuTreeResponse(BaseModel):
    items: list[MenuTreeNode]


class RoleDetailOut(RoleListItem):
    """角色详情：在列表项基础上附加已授权的菜单与功能权限点 key 集合。"""

    menu_keys: list[str] = Field(default_factory=list, description="已授权菜单 key（含全选父节点）")
    permission_keys: list[str] = Field(default_factory=list, description="已授权功能权限点 key（叶子编码）")


class PermissionTreeNode(BaseModel):
    """功能权限点授权树节点（module 作父节点，权限点编码作叶子）。"""

    key: str
    title: str
    selectable: bool = True
    description: str | None = None
    children: list["PermissionTreeNode"] = Field(default_factory=list)


PermissionTreeNode.model_rebuild()


class RolePermissionTreeResponse(BaseModel):
    items: list[PermissionTreeNode]


class RoleCreateRequest(BaseModel):
    role_code: str = Field(
        ..., min_length=2, max_length=64, pattern=ROLE_CODE_PATTERN,
        description="角色编码，小写字母开头，创建后不可修改",
    )
    role_name: str = Field(..., min_length=1, max_length=64, description="角色名称")
    description: str | None = Field(None, max_length=255, description="角色说明")
    data_scope: str = Field("self", description="数据范围：self/department/department_tree/hospital")
    status: str = Field("active", description="创建后状态：active/disabled")
    menu_keys: list[str] = Field(default_factory=list, description="授权的菜单 key 集合，可为空")
    permission_keys: list[str] = Field(
        default_factory=list, description="授权的功能权限点编码集合，可为空"
    )

    @field_validator("role_code", "role_name", mode="before")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("description", mode="before")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("role_code")
    @classmethod
    def _lower_code(cls, value: str) -> str:
        return value.lower()

    @field_validator("data_scope")
    @classmethod
    def _check_data_scope(cls, value: str) -> str:
        if value not in DATA_SCOPES:
            raise ValueError(f"数据范围必须为 {'/'.join(DATA_SCOPES)}")
        return value

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str) -> str:
        if value not in ROLE_STATUSES:
            raise ValueError(f"状态必须为 {'/'.join(ROLE_STATUSES)}")
        return value


class RoleUpdateRequest(BaseModel):
    """角色资料更新：所有字段可选；menu_keys 传空数组表示清空授权，传 null 表示不修改。"""

    role_name: str | None = Field(None, min_length=1, max_length=64)
    description: str | None = Field(None, max_length=255)
    data_scope: str | None = None
    status: str | None = None
    menu_keys: list[str] | None = Field(None, description="覆盖式菜单授权；系统内置角色不接受该字段")
    permission_keys: list[str] | None = Field(
        None, description="覆盖式功能权限点授权；系统内置角色不接受该字段"
    )

    @field_validator("role_name", mode="before")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("description", mode="before")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("data_scope")
    @classmethod
    def _check_data_scope(cls, value: str | None) -> str | None:
        if value is not None and value not in DATA_SCOPES:
            raise ValueError(f"数据范围必须为 {'/'.join(DATA_SCOPES)}")
        return value

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str | None) -> str | None:
        if value is not None and value not in ROLE_STATUSES:
            raise ValueError(f"状态必须为 {'/'.join(ROLE_STATUSES)}")
        return value


class RoleStatusRequest(BaseModel):
    """角色状态变更：active 启用 / disabled 停用（停用后其成员即时失去该角色）。"""

    status: str = Field(..., description="active/disabled")

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str) -> str:
        if value not in ROLE_STATUSES:
            raise ValueError(f"状态必须为 {'/'.join(ROLE_STATUSES)}")
        return value
