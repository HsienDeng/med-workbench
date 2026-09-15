"""数据字典请求 / 响应模型。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

DICT_CATEGORIES = ("clinical", "lab", "coding", "business")
DICT_STATUSES = ("active", "disabled")

_CATEGORY_LABELS = {
    "clinical": "临床",
    "lab": "检验",
    "coding": "编码体系",
    "business": "业务",
}


def category_label(category: str) -> str:
    return _CATEGORY_LABELS.get(category, category)


def _clean(value: str | None) -> str | None:
    """去掉首尾空白，空串归一为 None。"""
    if value is None:
        return None
    value = value.strip()
    return value or None


class DictionaryOut(BaseModel):
    """字典列表 / 详情项。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    hospital_id: int
    dict_code: str
    dict_name: str
    category: str
    description: str | None = None
    status: str
    builtin: bool
    sort_order: int
    created_by: str
    created_at: datetime
    updated_at: datetime
    item_count: int = 0

    @field_validator("description", mode="before")
    @classmethod
    def _empty_to_none(cls, value: str | None) -> str | None:
        return _clean(value)


class DictionaryListResponse(BaseModel):
    items: list[DictionaryOut]
    total: int
    page: int
    page_size: int


class DictionaryCreateRequest(BaseModel):
    dict_code: str = Field(..., min_length=1, max_length=64, description="字典编码，租户内唯一")
    dict_name: str = Field(..., min_length=1, max_length=128, description="字典名称")
    category: str = Field("business", description="分类：clinical/lab/coding/business")
    description: str | None = Field(None, max_length=500, description="字典说明")
    status: str = Field("active", description="active/disabled")
    sort_order: int = Field(0, ge=0, description="显示顺序")

    @field_validator("dict_code", "dict_name", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("category")
    @classmethod
    def _check_category(cls, value: str) -> str:
        if value not in DICT_CATEGORIES:
            raise ValueError(f"分类必须为 {'/'.join(DICT_CATEGORIES)}")
        return value

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str) -> str:
        if value not in DICT_STATUSES:
            raise ValueError("状态必须为 active 或 disabled")
        return value

    @field_validator("description", mode="before")
    @classmethod
    def _clean_desc(cls, value: str | None) -> str | None:
        return _clean(value)


class DictionaryUpdateRequest(BaseModel):
    """字典更新：所有字段可选，传 None 表示不修改（description 传空串表示清空）。"""

    dict_name: str | None = Field(None, min_length=1, max_length=128)
    category: str | None = None
    description: str | None = None
    status: str | None = None
    sort_order: int | None = Field(None, ge=0)

    @field_validator("dict_name", mode="before")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("category")
    @classmethod
    def _check_category(cls, value: str | None) -> str | None:
        if value is not None and value not in DICT_CATEGORIES:
            raise ValueError(f"分类必须为 {'/'.join(DICT_CATEGORIES)}")
        return value

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str | None) -> str | None:
        if value is not None and value not in DICT_STATUSES:
            raise ValueError("状态必须为 active 或 disabled")
        return value

    @field_validator("description", mode="before")
    @classmethod
    def _clean_desc(cls, value: str | None) -> str | None:
        return _clean(value)


class DictionaryItemOut(BaseModel):
    """字典项列表 / 详情项。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    dictionary_id: int
    item_code: str
    item_label: str
    item_value: str | None = None
    sort_order: int
    status: str
    remark: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("item_value", "remark", mode="before")
    @classmethod
    def _empty_to_none(cls, value: str | None) -> str | None:
        return _clean(value)


class DictionaryItemListResponse(BaseModel):
    items: list[DictionaryItemOut]
    total: int
    page: int
    page_size: int


class DictionaryItemCreateRequest(BaseModel):
    item_code: str = Field(..., min_length=1, max_length=64, description="项编码，字典内唯一")
    item_label: str = Field(..., min_length=1, max_length=255, description="显示名称")
    item_value: str | None = Field(None, max_length=255, description="项值，缺省同项编码")
    sort_order: int = Field(0, ge=0, description="显示顺序")
    status: str = Field("active", description="active/disabled")
    remark: str | None = Field(None, max_length=500)

    @field_validator("item_code", "item_label", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("item_value", "remark", mode="before")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str) -> str:
        if value not in DICT_STATUSES:
            raise ValueError("状态必须为 active 或 disabled")
        return value


class DictionaryItemUpdateRequest(BaseModel):
    item_label: str | None = Field(None, min_length=1, max_length=255)
    item_value: str | None = None
    sort_order: int | None = Field(None, ge=0)
    status: str | None = None
    remark: str | None = None

    @field_validator("item_label", mode="before")
    @classmethod
    def _strip_label(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("item_value", "remark", mode="before")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str | None) -> str | None:
        if value is not None and value not in DICT_STATUSES:
            raise ValueError("状态必须为 active 或 disabled")
        return value


class DictionaryItemBatchRequest(BaseModel):
    """批量导入字典项：每行 `code,label,value`，分号或换行分隔。"""

    text: str = Field(..., min_length=1, max_length=20000, description="每行一条：编码,显示名[,值]")


class DictionaryOption(BaseModel):
    """供其它页面下拉复用的精简字典项。"""

    code: str
    label: str
    value: str


class DictionaryOptionsResponse(BaseModel):
    dict_code: str
    dict_name: str
    options: list[DictionaryOption] = []
