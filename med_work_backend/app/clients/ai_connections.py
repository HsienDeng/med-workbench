"""面向前端的 AI 连接状态投影：全部来自 med_ai_provider_configs 表。"""

import logging

from sqlalchemy import select

from app.config import Settings
from app.schemas.ai import AIConnection
from app.models import AiProviderConfig as AiProviderConfigRow

logger = logging.getLogger(__name__)

_PROTOCOL_LABELS = {"openai": "OpenAI Compatible", "anthropic": "Anthropic"}


def list_ai_connections(settings: Settings) -> list[AIConnection]:
    """生成不包含明文凭据的连接列表；表为空时返回空列表。"""
    from app.database import SessionLocal

    with SessionLocal() as db:
        rows = db.scalars(
            select(AiProviderConfigRow)
            .where(AiProviderConfigRow.status == "active")
            .order_by(AiProviderConfigRow.sort_order, AiProviderConfigRow.id)
        ).all()

    items: list[AIConnection] = []
    for row in rows:
        has_api_key = bool(row.api_key_cipher)
        if row.is_active and has_api_key:
            status = "connected"
        elif has_api_key:
            status = "ready"
        else:
            status = "error"
        cached = list(row.cached_models or [])
        default_model = row.default_model or ""
        items.append(
            AIConnection(
                id=f"{row.provider}-{row.id}",
                provider=row.provider,
                name=row.display_name,
                protocol=_PROTOCOL_LABELS.get(row.protocol, row.protocol),
                base_url=row.base_url,
                active_model=default_model,
                models=list(dict.fromkeys([default_model, *cached])),
                status=status,
                enabled=has_api_key,
                has_api_key=has_api_key,
                api_key_last4=row.api_key_last4,
                is_active=bool(row.is_active),
                cached_models=cached,
            )
        )
    return items
