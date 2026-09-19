"""病历分析记录请求 / 响应模型。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AnalysisRecordCreateIn(BaseModel):
    """创建病历分析请求：选择患者 + 病历 + 分析类型。"""

    patient_id: int = Field(..., gt=0, description="患者ID")
    medical_record_id: int = Field(..., gt=0, description="病历记录ID")
    analysis_type: str = Field(
        default="record",
        description="record: 病历结构化 / medication: 用药审核 / risk: 风险评估 / exam: 检查解读",
    )


class AnalysisAttentionItem(BaseModel):
    """AI 关注点条目。"""

    title: str
    description: str
    level: str = Field(default="中", description="优先级：高 / 中 / 低")


class AnalysisResult(BaseModel):
    """病历分析结构化结果（与 app/clients/llm.py 提示词契约一致）。"""

    summary: dict[str, str] = Field(default_factory=dict, description="病情要点，如 主诉/现病史/初步诊断")
    attention: list[AnalysisAttentionItem] = Field(default_factory=list, description="AI 关注点")
    evidence: list[dict] = Field(
        default_factory=list,
        description="证据来源 [{source, relevance, document_id?}]，document_id 命中知识库时存在，可下载原文",
    )


class AnalysisRecordItem(BaseModel):
    """分析记录列表 / 详情项。"""

    id: int
    patient_id: int
    patient_name: str = Field(default="", description="患者姓名（联查填充）")
    medical_record_id: int
    analysis_type: str
    model: str
    status: str = Field(description="done / failed")
    result: Optional[AnalysisResult] = None
    error: Optional[str] = None
    created_at: datetime


class AnalysisRecordListResponse(BaseModel):
    """历史分析记录列表响应（分页）。"""

    items: list[AnalysisRecordItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class AnalysisStatsResponse(BaseModel):
    """分析任务统计响应。"""

    total: int = 0
    done: int = 0
    failed: int = 0
    today: int = 0


class AnalysisTrendItem(BaseModel):
    """按日统计的分析任务数。"""

    date: str = Field(description="日期，格式 MM-DD")
    count: int = 0


class AnalysisTrendResponse(BaseModel):
    """分析任务趋势响应（近 N 天按日统计）。"""

    days: int = 14
    items: list[AnalysisTrendItem] = Field(default_factory=list)
