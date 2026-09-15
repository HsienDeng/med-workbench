"""站内通知模型（med_notifications）。

承载系统内需要用户感知的事件（如 AI 分析失败可重试），配合顶部铃铛展示：
- 按 user_id 定向投递（目前用于分析发起人），hospital_id 承担租户隔离；
- resource_type / resource_id 保留跳转上下文（如 analysis_record / id）；
- is_read 标记已读，未读数由接口聚合返回。
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Notification(Base):
    """站内通知。"""

    __tablename__ = "med_notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment="所属医院ID，租户隔离")
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, index=True, comment="接收用户ID")
    type: Mapped[str] = mapped_column(String(32), nullable=False, comment="通知类型：analysis_failed / system 等")
    title: Mapped[str] = mapped_column(String(128), nullable=False, comment="通知标题")
    content: Mapped[Optional[str]] = mapped_column(Text, comment="通知正文")
    resource_type: Mapped[Optional[str]] = mapped_column(String(32), comment="关联资源类型：analysis_record 等")
    resource_id: Mapped[Optional[str]] = mapped_column(String(64), comment="关联资源ID")
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否已读")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="通知时间"
    )

    __table_args__ = (
        Index("ix_med_notifications_user_time", "user_id", "created_at"),
        Index("ix_med_notifications_hospital_user_read", "hospital_id", "user_id", "is_read"),
    )
