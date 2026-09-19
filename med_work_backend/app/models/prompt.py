"""提示词模板 ORM：预设医疗角色 + 用户自建模板。"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PromptTemplate(Base):
    """AI 聊天提示词模板。is_preset=True 为系统预设（全局可见、只读），
    自建模板按 user_id 隔离，仅本人可见可改删。"""

    __tablename__ = "med_prompt_templates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, comment="所属医院ID")
    user_id: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, comment="所属用户ID，0=系统预设"
    )
    is_preset: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否系统预设")
    name: Mapped[str] = mapped_column(String(64), nullable=False, comment="模板名称")
    description: Mapped[str | None] = mapped_column(String(255), comment="模板描述")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="角色设定文本")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="排序权重")
    created_at: Mapped[datetime] = mapped_column(DateTime, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, comment="更新时间")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, comment="软删除时间")
