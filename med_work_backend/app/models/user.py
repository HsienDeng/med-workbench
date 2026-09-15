"""用户模型。"""
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    """系统用户（登录账号）。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, comment="姓名")
    account: Mapped[str] = mapped_column(
        String(50), unique=True, index=True, nullable=False, comment="登录账号"
    )
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False, comment="密码哈希（PBKDF2）")
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="待分配科室", comment="角色 / 科室")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )
