"""患者档案请求 / 响应模型。"""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class PatientOut(BaseModel):
    """患者列表 / 基础详情。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_no: str
    name: str
    gender: str
    age: int
    birth_date: Optional[date] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    bmi: Optional[float] = None
    waistline: Optional[float] = None
    phone: Optional[str] = None
    primary_diag: str
    dept: str
    department_id: Optional[int] = None
    status: str
    allergy_history: Optional[str] = None
    past_history: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PatientCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=64, description="姓名")
    gender: str = Field(default="", max_length=16, description="性别：male / female")
    age: int = Field(default=0, ge=0, le=200, description="年龄")
    birth_date: Optional[date] = Field(default=None, description="出生日期（YYYY-MM-DD）")
    height: Optional[float] = Field(default=None, gt=0, le=250, description="身高（cm）")
    weight: Optional[float] = Field(default=None, gt=0, le=500, description="体重（kg）")
    waistline: Optional[float] = Field(default=None, gt=0, le=300, description="腰围（cm）")
    phone: Optional[str] = Field(default="", max_length=32, description="手机号")
    primary_diag: str = Field(default="", max_length=512, description="主诊断")
    dept: str = Field(default="", max_length=64, description="科室（字典 department 的 item code）")
    status: str = Field(default="in", max_length=32, description="状态（字典 patient_status 的 item code）")
    allergy_history: Optional[str] = Field(default=None, max_length=2000, description="档案层常驻过敏史")
    past_history: Optional[str] = Field(default=None, max_length=4000, description="档案层常驻既往史")


class PatientUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    gender: Optional[str] = Field(default=None, max_length=16)
    age: Optional[int] = Field(default=None, ge=0, le=200)
    birth_date: Optional[date] = Field(default=None, description="出生日期（YYYY-MM-DD）")
    height: Optional[float] = Field(default=None, gt=0, le=250)
    weight: Optional[float] = Field(default=None, gt=0, le=500)
    waistline: Optional[float] = Field(default=None, gt=0, le=300)
    phone: Optional[str] = Field(default=None, max_length=32)
    primary_diag: Optional[str] = Field(default=None, max_length=512)
    dept: Optional[str] = Field(default=None, max_length=64)
    status: Optional[str] = Field(default=None, max_length=32)
    allergy_history: Optional[str] = Field(default=None, max_length=2000)
    past_history: Optional[str] = Field(default=None, max_length=4000)


class PatientGroupOut(BaseModel):
    """详情中展示的患者绑定企微群。"""

    group_id: int
    chat_id: str
    name: str
    member_count: int
    bind_at: Optional[datetime] = None


class PatientDetailOut(PatientOut):
    groups: list[PatientGroupOut] = Field(default_factory=list)


class PatientListResponse(BaseModel):
    items: list[PatientOut] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class PatientTimelineEvent(BaseModel):
    """时间线事件：病历记录与 AI 分析合并后的统一结构。

    event_type：medical_record（病历）/ analysis（AI 分析）。
    detail 仅分析事件携带，结构与 /api/analysis/record 的 result 一致
    （{summary, attention, evidence}），便于前端复用同一套结论卡片。
    """

    event_type: str
    event_id: int
    time: datetime
    title: str
    summary: str = ""
    status: str = ""
    medical_record_id: Optional[int] = None
    analysis_type: str = ""
    model: str = ""
    operator: str = ""
    detail: Optional[dict] = None


class PatientTimelineResponse(BaseModel):
    items: list[PatientTimelineEvent] = Field(default_factory=list)
    total: int = 0


class EvolutionPoint(BaseModel):
    """单个关注点在历次分析中的出现记录。"""

    analysis_id: int
    time: datetime
    level: str = ""
    description: str = ""


class AttentionTrendItem(BaseModel):
    """同一关注点在各次分析中的等级轨迹。"""

    title: str
    points: list[EvolutionPoint] = Field(default_factory=list)
    latest_level: str = ""
    trend: str = "flat"  # up 加重 / down 减轻 / flat 持平 / new 首次出现


class DiagnosisPoint(BaseModel):
    """诊断结论演变节点（取分析 summary 中诊断类 key）。"""

    analysis_id: int
    time: datetime
    key: str
    value: str


class AnalysisEvolutionResponse(BaseModel):
    """患者维度分析演变（关注点等级轨迹 + 诊断结论时间线）。"""

    patient_id: int
    analyses: list[dict] = Field(default_factory=list)
    attention_trend: list[AttentionTrendItem] = Field(default_factory=list)
    diagnosis_timeline: list[DiagnosisPoint] = Field(default_factory=list)
