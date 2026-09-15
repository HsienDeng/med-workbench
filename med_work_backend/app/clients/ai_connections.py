"""面向前端的 AI 连接状态投影。"""

from app.config import Settings
from app.schemas.ai import AIConnection
from app.clients.ai_provider import get_active_provider_name


_PROVIDER_META = {
    "kimi": {"name": "Kimi", "models": ["kimi-k3", "kimi-k2.7-code"]},
    "o98k": {"name": "O98K 中转", "models": ["gpt-5.6-sol"]},
}


def list_ai_connections(settings: Settings) -> list[AIConnection]:
    """生成不包含明文凭据的连接列表。"""
    active_provider_name = get_active_provider_name(settings)
    items: list[AIConnection] = []
    for provider_name, meta in _PROVIDER_META.items():
        provider = settings.ai_providers[provider_name]
        has_api_key = provider.configured
        enabled = has_api_key
        if has_api_key and provider_name == active_provider_name:
            status = "connected"
        elif has_api_key:
            status = "ready"
        else:
            status = "error"
        items.append(
            AIConnection(
                id=f"{provider_name}-default",
                provider=provider_name,
                name=meta["name"],
                base_url=provider.base_url,
                active_model=provider.model,
                models=list(dict.fromkeys([provider.model, *meta["models"]])),
                status=status,
                enabled=enabled,
                has_api_key=has_api_key,
            )
        )
    return items
