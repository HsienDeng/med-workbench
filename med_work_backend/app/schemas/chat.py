from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """单条对话消息。"""

    role: str = Field(description="user / assistant / system")
    content: str
    citations: list[dict] | None = Field(
        default=None, description="assistant 消息的知识库引用（document_id/title/score/snippet）"
    )


class ChatRequest(BaseModel):
    """对话请求。"""

    messages: list[ChatMessage] = Field(description="对话历史，按时间正序")
    temperature: float = Field(default=0.3, ge=0, le=1)
    system_prompt: str | None = Field(default=None, description="覆盖默认的系统提示词")
    model: str | None = Field(
        default=None,
        description="本轮使用的模型名；为空时按当前激活 provider 默认模型",
    )


class ChatResponse(BaseModel):
    """对话响应。"""

    content: str
    model: str
    usage: dict | None = None
    citations: list[dict] = Field(default_factory=list, description="本轮回答引用的知识库条目")


class ChatConversationOut(BaseModel):
    """会话列表项（不含消息）。"""

    id: int
    title: str
    prompt_id: int | None = None
    updated_at: datetime | None = None


class ChatConversationDetail(ChatConversationOut):
    """会话详情（含消息）。"""

    messages: list[ChatMessage] = Field(default_factory=list)


class ChatConversationCreate(BaseModel):
    """创建会话请求。"""

    title: str = Field(default="新对话", max_length=128)
    prompt_id: int | None = Field(default=None, description="会话使用的提示词模板ID")


class ChatConversationUpdate(BaseModel):
    """更新会话请求（标题与消息均可选更新）。"""

    title: str | None = Field(default=None, max_length=128)
    prompt_id: int | None = Field(default=None, description="会话使用的提示词模板ID")
    messages: list[ChatMessage] | None = None


class AnalysisRequest(BaseModel):
    """病历分析请求。"""

    text: str = Field(description="病历原文")
    analysis_type: str = Field(default="record", description="record: 病历结构化 / medication: 用药审核 / risk: 风险评估 / exam: 检查解读")


class AnalysisItem(BaseModel):
    title: str
    description: str
    level: str = Field(default="中", description="优先级：高 / 中 / 低")


class AnalysisResult(BaseModel):
    """病历分析结构化结果。"""

    summary: dict[str, str] = Field(description="病情要点，如 主诉/现病史/既往史/初步诊断")
    attention: list[AnalysisItem] = Field(description="AI 关注点")
    evidence: list[dict] = Field(description="证据来源列表：{source, relevance}")


class AnalysisResponse(BaseModel):
    result: AnalysisResult
    model: str
