"""AI 助手对话 ORM 模型：会话 + 消息（消息按会话整存为 JSON）。

对话历史随用户持久化到 MySQL，刷新页面 / 重新登录后仍可恢复。
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ChatConversation(Base):
    """AI 助手会话。消息列表整存为 JSON 数组：[{role, content, status}]。"""

    __tablename__ = "med_chat_conversations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, comment="所属医院ID")
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属用户ID")
    title: Mapped[str] = mapped_column(String(128), nullable=False, default="新对话", comment="会话标题")
    messages: Mapped[list] = mapped_column(JSON, nullable=False, default=list, comment="消息列表 [{role,content,status}]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, comment="软删除时间")

    __table_args__ = (
        Index("ix_chat_conv_user", "hospital_id", "user_id", "deleted_at"),
    )
