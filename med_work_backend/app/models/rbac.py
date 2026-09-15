"""RBAC 组织权限模型。

映射 sql/001_organization_rbac.sql 中的 med_* 表（仅登录所需的子集）：
- med_hospitals   医院租户
- med_users       用户
- med_roles       角色
- med_user_roles  用户-角色关联
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Hospital(Base):
    """医院租户。"""

    __tablename__ = "med_hospitals"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, comment="医院编码，同时作为租户编码")
    hospital_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="医院全称")
    short_name: Mapped[Optional[str]] = mapped_column(String(64), comment="医院简称")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active/disabled")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="软删除时间")


class Department(Base):
    """医院科室组织节点，对应 med_departments。"""

    __tablename__ = "med_departments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID")
    parent_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment="上级科室ID，空值表示一级科室")
    department_code: Mapped[str] = mapped_column(String(32), nullable=False, comment="科室编码，同一医院内唯一")
    department_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="科室名称")
    department_type: Mapped[str] = mapped_column(String(20), nullable=False, default="clinical", comment="clinical/medical_tech/nursing/admin/other")
    tree_level: Mapped[int] = mapped_column(nullable=False, default=1, comment="科室层级，一级科室为 1")
    tree_path: Mapped[Optional[str]] = mapped_column(String(512), comment="科室树路径")
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0, comment="同级科室显示顺序")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active/disabled")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="软删除时间")


class RbacUser(Base):
    """平台用户（登录账号），对应 med_users。"""

    __tablename__ = "med_users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID")
    primary_department_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment="主科室ID")
    username: Mapped[str] = mapped_column(String(64), nullable=False, comment="登录账号，同一医院内唯一")
    employee_no: Mapped[Optional[str]] = mapped_column(String(64), comment="医院工号")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, comment="密码哈希")
    real_name: Mapped[str] = mapped_column(String(64), nullable=False, comment="真实姓名")
    gender: Mapped[Optional[str]] = mapped_column(String(16), comment="male/female/unknown")
    professional_title: Mapped[Optional[str]] = mapped_column(String(64), comment="职称或岗位名称")
    mobile_ciphertext: Mapped[Optional[str]] = mapped_column(String(512), comment="加密后的手机号码")
    mobile_hash: Mapped[Optional[str]] = mapped_column(String(64), comment="手机号 SHA-256 哈希")
    email_ciphertext: Mapped[Optional[str]] = mapped_column(String(512), comment="加密后的电子邮箱")
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), comment="头像地址")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="pending/active/locked/disabled")
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="下次登录是否必须改密")
    failed_login_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, comment="连续登录失败次数")
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="账号锁定截止时间")
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="最后登录时间")
    last_login_ip: Mapped[Optional[str]] = mapped_column(String(45), comment="最后登录IP")
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="最近一次修改密码时间")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="软删除时间")


class Role(Base):
    """医院级 RBAC 角色。"""

    __tablename__ = "med_roles"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID")
    role_code: Mapped[str] = mapped_column(String(64), nullable=False, comment="角色编码，同一医院内唯一")
    role_name: Mapped[str] = mapped_column(String(64), nullable=False, comment="角色名称")
    description: Mapped[Optional[str]] = mapped_column(String(255), comment="角色说明")
    data_scope: Mapped[str] = mapped_column(String(20), nullable=False, default="self", comment="self/department/department_tree/hospital")
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否系统内置角色")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active/disabled")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="软删除时间")


class UserRole(Base):
    """用户-角色关联。"""

    __tablename__ = "med_user_roles"

    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID，用于租户隔离")
    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="用户ID")
    role_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, comment="角色ID")
    assigned_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="角色分配时间")
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="授权到期时间，空值表示长期有效")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", comment="active/disabled")
