"""AI 供应商配置 ORM 模型（med_ai_provider_configs）。

把 AI 提供商的 base_url / API Key / 默认模型从 .env 迁移到数据库，
供 UI 增删改查；API Key 以 AES-GCM 加密落库（见 app/clients/ai_crypto.py）。
"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Index,
    Integer,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AiProviderConfig(Base):
    """AI 供应商配置行；is_active 在同一医院内至多一行（当前调用路由）。"""

    __tablename__ = "med_ai_provider_configs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, comment="所属医院ID")
    provider: Mapped[str] = mapped_column(String(64), nullable=False, comment="供应商唯一编码")
    display_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="显示名称")
    protocol: Mapped[str] = mapped_column(
        String(32), nullable=False, default="openai", comment="协议：openai 兼容 / anthropic"
    )
    base_url: Mapped[str] = mapped_column(String(512), nullable=False, comment="API 基础地址")
    api_key_cipher: Mapped[bytes | None] = mapped_column(LargeBinary(512), comment="AES-GCM 加密后的 API Key")
    api_key_last4: Mapped[str | None] = mapped_column(String(4), comment="Key 末 4 位（遮蔽显示）")
    default_model: Mapped[str] = mapped_column(String(128), nullable=False, default="", comment="默认调用模型")
    cached_models: Mapped[list | None] = mapped_column(JSON, comment="最近一次拉取的模型列表")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否当前路由")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active/disabled")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100, comment="显示顺序")
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system", comment="创建人账号")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("uk_ai_provider_hospital", "hospital_id", "provider", unique=True),
        Index("ix_ai_provider_active", "hospital_id", "is_active", "status"),
    )
