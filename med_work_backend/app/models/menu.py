"""动态菜单 ORM 模型。"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Menu(Base):
    """全局菜单目录；分组也使用同一棵树存储。"""

    __tablename__ = "med_menus"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("med_menus.id", ondelete="SET NULL"), comment="父级菜单ID"
    )
    menu_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, comment="菜单唯一键")
    route_key: Mapped[str | None] = mapped_column(String(64), comment="前端路由键，分组为空")
    title: Mapped[str] = mapped_column(String(64), nullable=False, comment="菜单名称")
    icon_name: Mapped[str | None] = mapped_column(String(64), comment="Ant Design 图标名")
    badge: Mapped[str | None] = mapped_column(String(32), comment="菜单角标")
    menu_type: Mapped[str] = mapped_column(String(16), nullable=False, default="page", comment="group/page")
    phase2: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否阶段二占位页")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="显示顺序")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active/disabled")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class RoleMenu(Base):
    """角色可见菜单授权记录。"""

    __tablename__ = "med_role_menus"

    role_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    menu_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("med_menus.id", ondelete="CASCADE"),
        primary_key=True,
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
