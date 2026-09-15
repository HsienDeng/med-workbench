"""登录用户可读的 AI 连接信息。"""

from fastapi import APIRouter, Depends

from app.config import settings
from app.deps import get_current_user, require_hospital_admin
from app.models import RbacUser
from app.schemas.ai import AIConnection, ActiveAIProviderResponse, ActiveAIProviderUpdate
from app.clients.ai_connections import list_ai_connections
from app.clients.ai_provider import set_active_provider

router = APIRouter(tags=["ai"])


@router.get("/ai/connections", response_model=list[AIConnection])
async def get_ai_connections(_current_user: RbacUser = Depends(get_current_user)) -> list[AIConnection]:
    """返回服务端已注册的模型路由；凭据永不返回。"""
    return list_ai_connections(settings)


@router.patch("/ai/active-provider", response_model=ActiveAIProviderResponse)
async def update_active_ai_provider(
    payload: ActiveAIProviderUpdate,
    _current_user: RbacUser = Depends(require_hospital_admin),
) -> ActiveAIProviderResponse:
    """切换后续请求使用的 AI 提供商并持久化到 Redis。"""
    provider = set_active_provider(payload.provider, settings)
    return ActiveAIProviderResponse(active_provider=provider.name)
