"""AI 病历分析记录 ORM 模型。

分析结果整存 JSON（沿用会话消息整存先例），历史详情零额外计算。
按 hospital_id + user_id 租户/用户隔离，仅保存分析摘要，不落病历全文。
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Index, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AnalysisRecord(Base):
    """AI 病历分析记录。"""

    __tablename__ = "med_analysis_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, comment="所属医院ID，租户隔离")
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="发起分析的用户ID")
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="患者ID")
    medical_record_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="病历记录ID")
    analysis_type: Mapped[str] = mapped_column(String(16), nullable=False, comment="分析类型：record/medication/risk/exam")
    model: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="AI 模型名")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="done", comment="状态：done/failed")
    result: Mapped[Optional[dict]] = mapped_column(JSON, comment="分析结果 {summary,attention,evidence}")
    error: Mapped[Optional[str]] = mapped_column(String(500), comment="失败原因摘要")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )

    __table_args__ = (
        Index("ix_analysis_user", "hospital_id", "user_id", "created_at"),
        Index("ix_analysis_record", "medical_record_id"),
    )
