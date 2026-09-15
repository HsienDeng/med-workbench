"""病历记录模型（病例分析场景）。

一次病历记录对应患者一次完整的诊疗/分析过程，涵盖病史、检查、治疗等
结构化自由文本字段。
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, BigInteger, DateTime, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MedicalRecord(Base):
    """患者病历记录。"""

    __tablename__ = "med_medical_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID，租户隔离")
    patient_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="患者ID")

    chief_complaint: Mapped[str] = mapped_column(Text, default="", comment="主诉")
    present_illness: Mapped[str] = mapped_column(Text, default="", comment="现病史")
    past_history: Mapped[str] = mapped_column(Text, default="", comment="既往史")
    allergy_history: Mapped[str] = mapped_column(Text, default="", comment="过敏史")
    drug_allergy_history: Mapped[str] = mapped_column(Text, default="", comment="药敏史")
    family_history: Mapped[str] = mapped_column(Text, default="", comment="家族史")
    physical_exam: Mapped[str] = mapped_column(Text, default="", comment="体格检查")
    treatment_advice: Mapped[str] = mapped_column(Text, default="", comment="处理意见")
    lab_tests: Mapped[str] = mapped_column(Text, default="", comment="检验")
    examinations: Mapped[str] = mapped_column(Text, default="", comment="检查")
    treatment: Mapped[str] = mapped_column(Text, default="", comment="治疗")
    medications: Mapped[str] = mapped_column(Text, default="", comment="药品")
    supplements: Mapped[str] = mapped_column(Text, default="", comment="补充内容")
    health_education: Mapped[str] = mapped_column(Text, default="", comment="健康教育")

    # ---- AI 分析结论归档（由某次已完成的分析结果快照写入） ----
    ai_conclusion: Mapped[Optional[dict]] = mapped_column(JSON, comment="归档的 AI 分析结论快照 {summary,attention,evidence}")
    ai_conclusion_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="结论归档时间")
    ai_conclusion_by: Mapped[Optional[int]] = mapped_column(BigInteger, comment="归档操作人 user_id")
    ai_conclusion_source_id: Mapped[Optional[int]] = mapped_column(BigInteger, comment="来源 AI 分析记录 id（med_analysis_records.id）")

    created_by: Mapped[Optional[int]] = mapped_column(BigInteger, comment="创建人 user_id")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="软删除时间")

    __table_args__ = (
        Index("ix_med_medical_records_patient", "hospital_id", "patient_id", "deleted_at"),
        Index("ix_med_medical_records_created", "patient_id", "created_at"),
    )
