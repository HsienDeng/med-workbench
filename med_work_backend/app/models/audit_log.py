"""操作审计日志模型（med_audit_logs）。

记录"谁、何时、从哪里、对什么资源、做了什么、结果如何"，用于医疗数据操作可追溯：
- 账号信息做冗余快照（username / real_name），账号停用或删除后审计仍可读；
- hospital_id 承担租户隔离；登录失败等尚无有效用户的场景允许为空；
- resource_type / resource_id 记录资源维度（如 patient / P-20260902-000001），
  方便按患者编号追踪该档案的全部操作轨迹；
- detail 为人类可读的简短摘要，不含患者姓名等敏感字段。
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuditLog(Base):
    """操作审计日志。"""

    __tablename__ = "med_audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, comment="所属医院ID，租户隔离；登录失败等匿名场景可能为空"
    )
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment="操作用户ID，快照值")
    username: Mapped[Optional[str]] = mapped_column(String(64), comment="操作用户账号（冗余快照）")
    real_name: Mapped[Optional[str]] = mapped_column(String(64), comment="操作用户姓名（冗余快照）")
    ip: Mapped[Optional[str]] = mapped_column(String(45), comment="来源IP，兼容IPv4/IPv6")
    user_agent: Mapped[Optional[str]] = mapped_column(String(255), comment="来源 UA")
    module: Mapped[str] = mapped_column(String(32), nullable=False, comment="功能模块：auth/patient/medical_record/analysis 等")
    action: Mapped[str] = mapped_column(String(32), nullable=False, comment="操作：login/view/create/update/delete/parse/logout")
    resource_type: Mapped[Optional[str]] = mapped_column(String(32), comment="资源类型：patient/medical_record/analysis_record 等")
    resource_id: Mapped[Optional[str]] = mapped_column(String(64), comment="资源标识：患者编号/记录ID等")
    detail: Mapped[Optional[str]] = mapped_column(String(500), comment="操作摘要（不含患者敏感字段）")
    result: Mapped[str] = mapped_column(String(16), nullable=False, default="success", comment="结果：success/failure/denied")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="审计时间（业务操作时间）"
    )

    __table_args__ = (
        Index("ix_med_audit_hospital_time", "hospital_id", "created_at"),
        Index("ix_med_audit_user_time", "user_id", "created_at"),
        Index("ix_med_audit_module_action", "module", "action", "created_at"),
        Index("ix_med_audit_resource", "resource_type", "resource_id", "created_at"),
    )
