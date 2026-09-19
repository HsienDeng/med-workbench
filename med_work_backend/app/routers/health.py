from fastapi import APIRouter

from app.config import settings
from app.database import check_database
from app.redis_client import check_redis
from app.clients.ai_provider import get_active_provider

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    try:
        provider = get_active_provider(settings)
        ai = {
            "provider": provider.name,
            "configured": provider.configured,
            "model": provider.model,
            "base_url": provider.base_url,
        }
    except Exception:  # noqa: BLE001
        ai = {"provider": None, "configured": False}
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "ai": ai,
        "database": {"connected": check_database()},
        "redis": {"connected": check_redis()},
    }
