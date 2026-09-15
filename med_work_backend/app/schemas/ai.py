"""AI 连接对外展示模型。"""

from typing import Literal

from pydantic import BaseModel


class AIConnection(BaseModel):
    """不含凭据的 AI 连接状态。"""

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


class ActiveAIProviderUpdate(BaseModel):
    """管理员切换当前 AI 路由的请求。"""

    provider: str


class ActiveAIProviderResponse(BaseModel):
    """当前已持久化的 AI 路由。"""

    active_provider: str
