from fastapi import APIRouter

from app.config import settings
from app.database import check_database
from app.redis_client import check_redis
from app.exceptions import RedisUnavailable
from app.clients.ai_provider import get_active_provider_name

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    try:
        active_provider_name = get_active_provider_name(settings)
    except RedisUnavailable:
        active_provider_name = settings.ai_provider
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "ai": {
            "provider": active_provider_name,
            **(
                {
                    "configured": provider.configured,
                    "model": provider.model,
                    "base_url": provider.base_url,
                }
                if (provider := settings.ai_providers.get(active_provider_name))
                else {"configured": False}
            ),
        },
        "database": {"connected": check_database()},
        "redis": {"connected": check_redis()},
    }
