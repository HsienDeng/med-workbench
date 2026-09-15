import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import AIProviderConfig
from app.database import get_db
from app.deps import get_current_user
from app.exceptions import AppError, NotFoundError
from app.models import ChatConversation, RbacUser
from app.schemas.chat import (
    AnalysisRequest,
    AnalysisResponse,
    ChatConversationCreate,
    ChatConversationDetail,
    ChatConversationOut,
    ChatConversationUpdate,
    ChatMessage,
    ChatRequest,
    ChatResponse,
)
from app.clients import kimi
from app.clients.ai_provider import get_active_provider
from app.config import settings
from app.services import agent_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


def _require_ai() -> AIProviderConfig:
    return get_active_provider(settings)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, user: RbacUser = Depends(get_current_user)) -> ChatResponse:
    """非流式对话（LangGraph Agent，需登录）。"""
    provider = _require_ai()
    try:
        content, citations = await agent_service.chat_once(req, user)
    except Exception as exc:  # noqa: BLE001
        logger.exception("chat agent 调用失败")
        raise AppError(f"调用 {provider.name} 失败：{exc}", code="MED_AI_CALL_FAILED") from exc
    return ChatResponse(content=content, model=provider.model, usage=None, citations=citations)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user: RbacUser = Depends(get_current_user)):
    """流式对话（LangGraph Agent，text/event-stream，需登录）。

    兼容前端 SSE 协议：`data: <增量文本>`，结束 `data: [DONE]`，错误 `data: [ERROR] <信息>`；
    若本轮引用了知识库，结束前会推送一条 `data: [CITATIONS] <json>` 事件。
    """
    provider = _require_ai()

    async def event_gen():
        try:
            async for piece in agent_service.chat_stream(req, user):
                yield f"data: {piece}\n\n"
        except Exception as exc:  # noqa: BLE001
            logger.exception("chat/stream agent 调用失败")
            yield f"data: [ERROR] {exc}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.post("/analysis", response_model=AnalysisResponse)
async def analysis(
    req: AnalysisRequest, _current_user: RbacUser = Depends(get_current_user)
) -> AnalysisResponse:
    """AI 病历分析（结构化输出，需登录，不经过 Agent）。"""
    provider = _require_ai()
    try:
        data = await kimi.analyze_record(req.text, req.analysis_type, provider)
    except Exception as exc:  # noqa: BLE001
        logger.exception("analysis 调用失败")
        raise AppError(f"调用 {provider.name} 失败：{exc}", code="MED_AI_CALL_FAILED") from exc
    return data


# ---------- 对话历史持久化（会话 + 消息，按用户隔离） ----------


def _owned_conversation(db: Session, conv_id: int, user: RbacUser) -> ChatConversation:
    """取当前用户所属的有效会话，不存在/不属于当前用户时抛 404。"""
    row = db.get(ChatConversation, conv_id)
    if (
        row is None
        or row.hospital_id != (user.hospital_id or 1)
        or row.user_id != user.id
        or row.deleted_at is not None
    ):
        raise NotFoundError("会话不存在")
    return row


@router.get("/chat/conversations", response_model=list[ChatConversationOut])
async def list_chat_conversations(
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatConversationOut]:
    """会话列表（不含消息，按更新时间倒序，仅当前用户）。"""
    rows = (
        db.query(ChatConversation)
        .filter(
            ChatConversation.hospital_id == (user.hospital_id or 1),
            ChatConversation.user_id == user.id,
            ChatConversation.deleted_at.is_(None),
        )
        .order_by(ChatConversation.updated_at.desc())
        .all()
    )
    return [
        ChatConversationOut(id=r.id, title=r.title, updated_at=r.updated_at) for r in rows
    ]


@router.get("/chat/conversations/{conv_id}", response_model=ChatConversationDetail)
async def get_chat_conversation(
    conv_id: int,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatConversationDetail:
    """会话详情（含消息）。"""
    row = _owned_conversation(db, conv_id, user)
    return ChatConversationDetail(
        id=row.id,
        title=row.title,
        updated_at=row.updated_at,
        messages=[ChatMessage.model_validate(m) for m in (row.messages or [])],
    )


@router.post("/chat/conversations", response_model=ChatConversationOut)
async def create_chat_conversation(
    payload: ChatConversationCreate,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatConversationOut:
    """创建会话。"""
    row = ChatConversation(
        hospital_id=user.hospital_id or 1,
        user_id=user.id,
        title=payload.title.strip() or "新对话",
        messages=[],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ChatConversationOut(id=row.id, title=row.title, updated_at=row.updated_at)


@router.put("/chat/conversations/{conv_id}", response_model=ChatConversationOut)
async def update_chat_conversation(
    conv_id: int,
    payload: ChatConversationUpdate,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatConversationOut:
    """更新会话：标题与消息均可选更新（消息整存）。"""
    row = _owned_conversation(db, conv_id, user)
    if payload.title is not None:
        row.title = payload.title.strip() or "新对话"
    if payload.messages is not None:
        row.messages = [m.model_dump() for m in payload.messages]
    db.commit()
    db.refresh(row)
    return ChatConversationOut(id=row.id, title=row.title, updated_at=row.updated_at)


@router.delete("/chat/conversations/{conv_id}", response_model=dict)
async def delete_chat_conversation(
    conv_id: int,
    user: RbacUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """删除会话（软删）。"""
    row = _owned_conversation(db, conv_id, user)
    row.deleted_at = func.now()
    db.commit()
    return {"ok": True}
