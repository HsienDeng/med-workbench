"""患者档案模型（病例分析场景，非医院 HIS）。

字段聚焦病例分析所需：患者基本资料 + 主诊断 + 科室 / 状态（字典维护）。

科室归属说明（数据范围落地的锚点）：
- dept           业务展示用临床科室（字典 department 的 item code）；
- department_id  组织科室（med_departments.id），是数据范围过滤的组织维度，
  新建 / 更新时由 dept 在组织科室树内自动解析（dept 与 department_code 对齐）。
  为 NULL 表示尚未纳入组织科室，此时仅创建人本人与全院范围（hospital）可见。
- created_by     归属人，承担 self（本人）数据范围过滤。
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Date, DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Patient(Base):
    """患者档案：基本信息 + 病例分析归属。"""

    __tablename__ = "med_patients"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属医院ID，租户隔离")
    department_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, comment="所在组织科室ID（med_departments.id），数据范围过滤用；NULL 表示未纳入组织科室"
    )
    patient_no: Mapped[str] = mapped_column(String(32), nullable=False, default="", comment="患者编号，后端自动生成")
    name: Mapped[str] = mapped_column(String(64), nullable=False, comment="姓名")
    gender: Mapped[str] = mapped_column(String(16), nullable=False, default="", comment="性别：male / female")
    age: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="年龄")
    birth_date: Mapped[Optional[date]] = mapped_column(Date, comment="出生日期（临床档案补全）")
    height: Mapped[Optional[float]] = mapped_column(Float, comment="身高（cm）")
    weight: Mapped[Optional[float]] = mapped_column(Float, comment="体重（kg）")
    bmi: Mapped[Optional[float]] = mapped_column(Float, comment="BMI，由身高体重自动计算")
    waistline: Mapped[Optional[float]] = mapped_column(Float, comment="腰围（cm）")
    phone: Mapped[Optional[str]] = mapped_column(String(32), default="", comment="手机号")
    primary_diag: Mapped[str] = mapped_column(String(512), nullable=False, default="", comment="主诊断")
    dept: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="科室（字典 department 的 item code）")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="in", comment="状态（字典 patient_status 的 item code）")
    # ---- 档案层常驻临床信息（与逐次病历字段区分，跨次可追溯） ----
    allergy_history: Mapped[Optional[str]] = mapped_column(Text, comment="档案层常驻过敏史")
    past_history: Mapped[Optional[str]] = mapped_column(Text, comment="档案层常驻既往史")
    created_by: Mapped[Optional[int]] = mapped_column(BigInteger, comment="创建人 user_id")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="软删除时间")

    __table_args__ = (
        Index("ix_med_patients_no", "hospital_id", "patient_no", unique=True),
        Index("ix_med_patients_name", "hospital_id", "name", "deleted_at"),
        Index("ix_med_patients_status", "hospital_id", "status", "deleted_at"),
    )
