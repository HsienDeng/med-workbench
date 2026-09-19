"""AI 连接与供应商配置对外模型。"""

from typing import Literal

from pydantic import BaseModel, Field

AiProtocol = Literal["openai", "anthropic"]


class AIConnection(BaseModel):
    """不含凭据的 AI 连接状态（旧 /ai/connections 投影，保留兼容）。"""

    id: str
    provider: str
    name: str
    protocol: str = "OpenAI Compatible"
    base_url: str
    active_model: str
    models: list[str]
    status: Literal["connected", "ready", "error"]
    enabled: bool
    has_api_key: bool
    api_key_last4: str | None = None
    is_active: bool = False
    cached_models: list[str] = Field(default_factory=list)


class AIProviderCreate(BaseModel):
    """新增 AI 供应商。"""

    provider: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,31}$", description="供应商唯一编码")
    display_name: str = Field(min_length=1, max_length=128)
    protocol: AiProtocol = "openai"
    base_url: str = Field(pattern=r"^https?://", description="API 基础地址")
    api_key: str = Field(default="", max_length=512)
    default_model: str = Field(default="", max_length=128)
    sort_order: int = 100


class AIProviderUpdate(BaseModel):
    """更新 AI 供应商；全部字段可选，api_key=None 表示保持原值。"""

    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    protocol: AiProtocol | None = None
    base_url: str | None = Field(default=None, pattern=r"^https?://")
    api_key: str | None = Field(default=None, max_length=512)
    default_model: str | None = Field(default=None, max_length=128)
    sort_order: int | None = None
    status: Literal["active", "disabled"] | None = None


class AIProviderItem(BaseModel):
    """AI 供应商配置（不含明文凭据）。"""

    id: int
    provider: str
    display_name: str
    protocol: AiProtocol
    base_url: str
    default_model: str
    cached_models: list[str] = Field(default_factory=list)
    is_active: bool
    status: str
    sort_order: int
    has_api_key: bool
    api_key_last4: str | None = None


class AIProviderFetchModelsRequest(BaseModel):
    """按表单草稿拉取模型列表（未保存前的临时探测，不落库）。"""

    protocol: AiProtocol = "openai"
    base_url: str = Field(pattern=r"^https?://", description="API 基础地址")
    api_key: str = Field(default="", max_length=512)
    default_model: str = Field(default="", max_length=128)


class AIProviderProbeResult(BaseModel):
    """测速 / 模型列表拉取结果。"""

    provider: str
    ok: bool
    latency_ms: int | None = None
    models: list[str] = Field(default_factory=list)
    error: str | None = None


class ActiveAIProviderUpdate(BaseModel):
    """管理员切换当前 AI 路由的请求（旧端点保留兼容）。"""

    provider: str


class ActiveAIProviderResponse(BaseModel):
    """当前已持久化的 AI 路由。"""

    active_provider: str
