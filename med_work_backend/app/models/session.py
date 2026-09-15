"""登录会话模型（服务端存储的访问令牌）。

token 明文仅返回给客户端一次，库中只保存 SHA-256 哈希，
即使数据库泄露也无法伪造有效令牌。
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserSession(Base):
    """登录会话，对应 med_sessions。"""

    __tablename__ = "med_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID")
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True, comment="用户ID")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, comment="令牌SHA-256哈希")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, comment="过期时间")
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="撤销时间")
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="最后使用时间")
    ip: Mapped[Optional[str]] = mapped_column(String(45), comment="登录IP")
    user_agent: Mapped[Optional[str]] = mapped_column(String(255), comment="客户端User-Agent")
