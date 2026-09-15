"""动态菜单响应模型。"""

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class MenuOut(BaseModel):
    """扁平菜单节点；前端依据 parent_key 组装侧边栏树。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: int
    key: str
    parent_key: str | None = None
    route_key: str | None = None
    title: str
    icon: str | None = None
    badge: str | None = None
    phase2: bool = False
    collapsible: bool = False
    sort_order: int = 0
    children: list["MenuOut"] = Field(default_factory=list)


class MenuListResponse(BaseModel):
    """当前用户可见菜单集合。"""

    items: list[MenuOut] = Field(default_factory=list)
