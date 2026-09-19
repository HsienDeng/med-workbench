"""提示词模板 Pydantic 模型。"""

from datetime import datetime

from pydantic import BaseModel, Field


class PromptOut(BaseModel):
    """模板列表项。"""

    id: int
    name: str
    description: str | None = None
    content: str
    is_preset: bool
    sort_order: int = 0
    updated_at: datetime | None = None


class PromptCreate(BaseModel):
    """新建模板。"""

    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    content: str = Field(min_length=1, max_length=8000)


class PromptUpdate(BaseModel):
    """更新模板（字段可选）。"""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    content: str | None = Field(default=None, min_length=1, max_length=8000)
