"""Redis 持久化的运行时 AI 提供商路由。"""

from app.config import AIProviderConfig, Settings
from app.exceptions import AiProviderInvalid, AiProviderNotConfigured
from app.redis_client import redis_get, redis_set_persistent

ACTIVE_PROVIDER_KEY = "med-workbench:ai:active-provider"


def _get_registered_provider(provider_name: str, settings: Settings) -> AIProviderConfig:
    normalized_name = provider_name.strip().lower()
    provider = settings.ai_providers.get(normalized_name)
    if provider is None:
        supported = "、".join(settings.ai_providers)
        raise AiProviderInvalid(f"不支持 AI 供应商 {provider_name!r}，可选：{supported}")
    return provider


def get_active_provider_name(settings: Settings) -> str:
    """读取当前路由；Redis 未设置时回退到 AI_PROVIDER。"""
    persisted_name = redis_get(ACTIVE_PROVIDER_KEY)
    provider_name = settings.ai_provider if persisted_name is None else persisted_name
    return _get_registered_provider(provider_name, settings).name


def get_active_provider(settings: Settings) -> AIProviderConfig:
    """返回当前可调用的提供商配置。"""
    provider = _get_registered_provider(get_active_provider_name(settings), settings)
    if not provider.configured:
        raise AiProviderNotConfigured(f"AI 提供商 {provider.name} 未配置 API Key")
    return provider


def set_active_provider(provider_name: str, settings: Settings) -> AIProviderConfig:
    """校验并持久化新的运行时路由。"""
    provider = _get_registered_provider(provider_name, settings)
    if not provider.configured:
        raise AiProviderNotConfigured(f"AI 提供商 {provider.name} 未配置 API Key")
    redis_set_persistent(ACTIVE_PROVIDER_KEY, provider.name)
    return provider
