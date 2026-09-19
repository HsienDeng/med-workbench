"""运行时 AI 提供商路由：配置与当前路由全部以 med_ai_provider_configs 表为准。

供应商、API Key、默认模型、当前路由均由「AI 服务与 API Key」管理页维护，
不再提供 .env 硬编码入口；对外接口签名保持不变，chat / 分析等调用方无需感知。
"""

import logging

from pydantic import SecretStr
from sqlalchemy import select

from app.config import AIProviderConfig, Settings
from app.exceptions import AiProviderInvalid, AiProviderNotConfigured
from app.models import AiProviderConfig as AiProviderConfigRow

logger = logging.getLogger(__name__)


def _decrypt_row_key(row: AiProviderConfigRow) -> str:
    """解密 DB 行的 API Key；解密失败按未配置处理并记录错误。"""
    from app.clients import ai_crypto

    try:
        return ai_crypto.decrypt_api_key(row.api_key_cipher)
    except Exception as exc:  # noqa: BLE001
        logger.error("解密 AI 供应商 %s 的 API Key 失败（密钥变更或密文损坏）：%s", row.provider, exc)
        return ""


def _load_db_providers() -> tuple[dict[str, AIProviderConfig], str | None]:
    """读取 DB 中的启用供应商；返回 (providers, active_name)。表为空时返回 ({}, None)。"""
    from app.database import SessionLocal

    providers: dict[str, AIProviderConfig] = {}
    active_name: str | None = None
    with SessionLocal() as db:
        rows = db.scalars(
            select(AiProviderConfigRow).where(AiProviderConfigRow.status == "active")
        ).all()
        for row in rows:
            providers[row.provider] = AIProviderConfig(
                row.provider,
                SecretStr(_decrypt_row_key(row)),
                row.base_url,
                row.default_model or "",
            )
            if row.is_active:
                active_name = row.provider
    return providers, active_name


def get_active_provider_name(settings: Settings) -> str:
    """读取当前路由名；无任何可用供应商时抛 AiProviderInvalid。"""
    providers, active_name = _load_db_providers()
    if not providers:
        raise AiProviderInvalid("服务端尚未配置任何 AI 供应商，请管理员在「AI 服务与 API Key」页面添加")
    name = active_name or next(iter(providers))
    if name not in providers:
        raise AiProviderInvalid(f"AI 供应商 {name!r} 已不可用")
    return name


def get_active_provider(settings: Settings) -> AIProviderConfig:
    """返回当前可调用的提供商配置。"""
    providers, active_name = _load_db_providers()
    if not providers:
        raise AiProviderInvalid("服务端尚未配置任何 AI 供应商，请管理员在「AI 服务与 API Key」页面添加")
    provider = providers[active_name or next(iter(providers))]
    if not provider.configured:
        raise AiProviderNotConfigured(f"AI 提供商 {provider.name} 未配置 API Key")
    return provider


def set_active_provider(
    provider_name: str, settings: Settings, *, hospital_id: int | None = None
) -> AIProviderConfig:
    """激活指定供应商并持久化到 DB（is_active 单选，同院其余行清零）。"""
    normalized_name = provider_name.strip().lower()
    from app.database import SessionLocal

    with SessionLocal() as db:
        stmt = select(AiProviderConfigRow).where(
            AiProviderConfigRow.provider == normalized_name,
            AiProviderConfigRow.status == "active",
        )
        if hospital_id is not None:
            stmt = stmt.where(AiProviderConfigRow.hospital_id == hospital_id)
        row = db.scalar(stmt)
        if row is None:
            all_names = [
                name
                for (name,) in db.execute(
                    select(AiProviderConfigRow.provider).where(AiProviderConfigRow.status == "active")
                ).all()
            ]
            supported = "、".join(all_names) if all_names else "（无）"
            raise AiProviderInvalid(f"不支持 AI 供应商 {provider_name!r}，可选：{supported}")
        api_key = _decrypt_row_key(row)
        if not api_key:
            raise AiProviderNotConfigured(f"AI 提供商 {row.provider} 未配置 API Key")
        for other in db.scalars(
            select(AiProviderConfigRow).where(AiProviderConfigRow.is_active.is_(True))
        ).all():
            other.is_active = False
        row.is_active = True
        db.commit()
        return AIProviderConfig(
            row.provider, SecretStr(api_key), row.base_url, row.default_model or ""
        )
