"""权限点 ORM 模型：med_permissions / med_role_permissions。

权限点（Permission）是比菜单更细粒度的「功能操作」授权：
- med_permissions         权限点定义（全局目录，不区分医院）
- med_role_permissions    角色-权限点授权（角色可见的细粒度操作能力）

与 med_role_menus 的关系：菜单决定「页面可见」，权限点决定「页面内操作可用」，
两者解耦，权限管理界面可分别配置；登录后用户权限点集合由 deps.require_permission 消费。
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Permission(Base):
    """功能权限点定义表。"""

    __tablename__ = "med_permissions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    permission_code: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, comment="全局唯一权限编码，例如 patient:view")
    permission_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="权限名称")
    module_code: Mapped[str] = mapped_column(String(64), nullable=False, comment="所属功能模块编码")
    resource_code: Mapped[str] = mapped_column(String(64), nullable=False, comment="受保护资源编码")
    action_code: Mapped[str] = mapped_column(String(32), nullable=False, comment="操作编码，例如 view/create/update/delete")
    description: Mapped[str | None] = mapped_column(String(255), comment="权限说明")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="权限显示顺序，数值越小越靠前")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active/disabled")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class RolePermission(Base):
    """角色-权限点授权关联表。"""

    __tablename__ = "med_role_permissions"

    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID，用于租户隔离")
    role_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="角色ID")
    permission_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="权限ID")
    granted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="权限授予时间")
