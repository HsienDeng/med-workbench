"""病历记录请求 / 响应模型。"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class MedicalRecordOut(BaseModel):
    """病历记录响应（完整字段）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    chief_complaint: str = ""
    present_illness: str = ""
    past_history: str = ""
    allergy_history: str = ""
    drug_allergy_history: str = ""
    family_history: str = ""
    physical_exam: str = ""
    treatment_advice: str = ""
    lab_tests: str = ""
    examinations: str = ""
    treatment: str = ""
    medications: str = ""
    supplements: str = ""
    health_education: str = ""
    # AI 分析结论归档快照（由某次已完成的分析归档写入，未归档为 None）
    ai_conclusion: Optional[dict] = Field(default=None, description="归档的 AI 分析结论快照 {summary,attention,evidence}")
    ai_conclusion_at: Optional[datetime] = Field(default=None, description="结论归档时间")
    ai_conclusion_by: Optional[int] = Field(default=None, description="归档操作人 user_id")
    ai_conclusion_source_id: Optional[int] = Field(default=None, description="来源 AI 分析记录 id")
    created_at: datetime
    updated_at: datetime


class MedicalRecordArchiveIn(BaseModel):
    """归档 AI 分析结论到病历：指定一条该患者已完成的分析记录。"""

    analysis_id: int = Field(..., gt=0, description="来源分析记录 ID（须已完成且属于该患者）")


class MedicalRecordCreateIn(BaseModel):
    """新建病历记录：所有字段均可选，空字段以空串保存。"""

    chief_complaint: str = Field(default="", description="主诉")
    present_illness: str = Field(default="", description="现病史")
    past_history: str = Field(default="", description="既往史")
    allergy_history: str = Field(default="", description="过敏史")
    drug_allergy_history: str = Field(default="", description="药敏史")
    family_history: str = Field(default="", description="家族史")
    physical_exam: str = Field(default="", description="体格检查")
    treatment_advice: str = Field(default="", description="处理意见")
    lab_tests: str = Field(default="", description="检验")
    examinations: str = Field(default="", description="检查")
    treatment: str = Field(default="", description="治疗")
    medications: str = Field(default="", description="药品")
    supplements: str = Field(default="", description="补充内容")
    health_education: str = Field(default="", description="健康教育")


class MedicalRecordUpdateIn(BaseModel):
    """更新病历记录：仅更新传入的字段。"""

    chief_complaint: Optional[str] = Field(default=None, description="主诉")
    present_illness: Optional[str] = Field(default=None, description="现病史")
    past_history: Optional[str] = Field(default=None, description="既往史")
    allergy_history: Optional[str] = Field(default=None, description="过敏史")
    drug_allergy_history: Optional[str] = Field(default=None, description="药敏史")
    family_history: Optional[str] = Field(default=None, description="家族史")
    physical_exam: Optional[str] = Field(default=None, description="体格检查")
    treatment_advice: Optional[str] = Field(default=None, description="处理意见")
    lab_tests: Optional[str] = Field(default=None, description="检验")
    examinations: Optional[str] = Field(default=None, description="检查")
    treatment: Optional[str] = Field(default=None, description="治疗")
    medications: Optional[str] = Field(default=None, description="药品")
    supplements: Optional[str] = Field(default=None, description="补充内容")
    health_education: Optional[str] = Field(default=None, description="健康教育")


class MedicalRecordListResponse(BaseModel):
    """病历记录列表响应（按创建时间倒序）。"""

    items: list[MedicalRecordOut] = Field(default_factory=list)
    total: int = 0


class MedicalRecordParseResponse(BaseModel):
    """病历文件 AI 解析结果（字段与新建入参一致，均可选）。"""

    source: str = Field(default="text", description="解析来源：image / pdf / word / text")
    chief_complaint: str = Field(default="", description="主诉")
    present_illness: str = Field(default="", description="现病史")
    past_history: str = Field(default="", description="既往史")
    allergy_history: str = Field(default="", description="过敏史")
    drug_allergy_history: str = Field(default="", description="药敏史")
    family_history: str = Field(default="", description="家族史")
    physical_exam: str = Field(default="", description="体格检查")
    treatment_advice: str = Field(default="", description="处理意见")
    lab_tests: str = Field(default="", description="检验")
    examinations: str = Field(default="", description="检查")
    treatment: str = Field(default="", description="治疗")
    medications: str = Field(default="", description="药品")
    supplements: str = Field(default="", description="补充内容")
    health_education: str = Field(default="", description="健康教育")
