"""操作审计日志查询响应模型。"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AuditLogItem(BaseModel):
    """单条审计记录。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    real_name: Optional[str] = None
    ip: Optional[str] = None
    module: str
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    detail: Optional[str] = None
    result: str
    created_at: datetime


class AuditLogListResponse(BaseModel):
    """审计日志分页列表。"""

    items: list[AuditLogItem]
    total: int
    page: int
    page_size: int


class AuditOptionsResponse(BaseModel):
    """审计筛选选项（模块 / 操作），保持与后端埋点值一致。"""

    modules: list[str]
    actions: list[str]
