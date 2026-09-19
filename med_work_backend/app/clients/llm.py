"""LangChain LLM 服务封装：指向当前激活的 AI 提供商。

供应商与凭据来自 med_ai_provider_configs 表（「AI 服务与 API Key」管理页维护），
由 app.clients.ai_provider 动态路由，本模块与具体供应商解耦。
"""

import base64
import io
import json
import logging
import re
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.config import AIProviderConfig, settings
from app.schemas.chat import ChatMessage, ChatRequest
from app.clients.ai_provider import get_active_provider
from app.exceptions import AppError

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "你是 MedAI Workbench 的医疗 AI 助手，服务于医疗机构用户。"
    "请给出专业、严谨、结构化的回答；涉及诊疗建议时必须声明仅供参考，需经临床医生审核。"
)


# 部分推理模型仅支持 temperature=1，传入其他值会导致 400
_REASONING_MODELS = ("kimi-k3", "kimi-2.6", "kimi-k2.7", "kimi-k2.5")


def get_active_ai() -> AIProviderConfig:
    """返回当前可用的 AI 提供商；缺失密钥时给出明确错误。"""
    return get_active_provider(settings)


def get_llm(
    model: str | None = None,
    temperature: float = 0.3,
    provider: AIProviderConfig | None = None,
    **kwargs: Any,
) -> BaseChatModel:
    """构建 LangChain ChatOpenAI 实例，指向当前激活的提供商。"""
    provider = provider or get_active_ai()
    model = model or provider.model
    if any(tag in model.lower() for tag in _REASONING_MODELS):
        temperature = 1.0
    return ChatOpenAI(
        model=model,
        api_key=provider.api_key,
        base_url=provider.base_url,
        temperature=temperature,
        timeout=60,
        max_retries=2,
        **kwargs,
    )


def to_langchain_messages(req: ChatRequest) -> list[BaseMessage]:
    """把请求消息转为 LangChain 消息序列（首条 system 归一化）。"""
    msgs: list[BaseMessage] = []
    if req.system_prompt:
        msgs.append(SystemMessage(content=req.system_prompt))
    elif not req.messages or req.messages[0].role != "system":
        msgs.append(SystemMessage(content=DEFAULT_SYSTEM_PROMPT))

    for m in req.messages:
        if m.role == "system":
            continue
        if m.role == "assistant":
            msgs.append(AIMessage(content=m.content))
        else:
            msgs.append(HumanMessage(content=m.content))
    return msgs


_REASONING_BLOCK_TYPES = ("reasoning", "thinking", "reasoning_content")


def content_to_text(content: Any) -> str:
    """把消息 content 规整为纯文本（不含推理内容）。

    部分 OpenAI 兼容网关会把内容包装成 multimodal 块列表，例如
    ``[{"type": "text", "text": "你好", "index": 0}]``（甚至带 phase 等额外字段）；
    此时直接用 str() 会得到 Python 字面量并原样渲染给用户，因此按块抽取 text 字段。
    推理块（reasoning/thinking）不在此列，见 reasoning_to_text。
    """
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if block.get("type") in _REASONING_BLOCK_TYPES:
                    continue
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content)


def reasoning_to_text(content: Any) -> str:
    """从消息 content 中抽取推理（思考）文本。

    Responses API 的推理摘要形如
    ``[{"type": "reasoning", "summary": [{"type": "summary_text", "text": "..."}]}]``；
    部分网关也会用 ``{"type": "thinking", "text": "..."}``。无推理内容时返回空串。
    """
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") not in _REASONING_BLOCK_TYPES:
            continue
        summary = block.get("summary")
        if isinstance(summary, list):
            for s in summary:
                if isinstance(s, dict) and isinstance(s.get("text"), str):
                    parts.append(s["text"])
        if isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "".join(parts)


def convert_message(msg: BaseMessage) -> ChatMessage:
    role = "assistant" if isinstance(msg, AIMessage) else "user"
    return ChatMessage(role=role, content=content_to_text(msg.content))


async def chat_once(
    req: ChatRequest, provider: AIProviderConfig | None = None
) -> tuple[str, dict | None]:
    """非流式对话，返回 (回复文本, usage)。"""
    llm = get_llm(temperature=req.temperature, provider=provider)
    messages = to_langchain_messages(req)
    resp = await llm.ainvoke(messages)
    text = content_to_text(resp.content)
    usage = getattr(resp, "usage_metadata", None)
    return text, usage


async def chat_stream(req: ChatRequest, provider: AIProviderConfig | None = None):
    """流式对话，逐片 yield 文本。"""
    llm = get_llm(temperature=req.temperature, provider=provider)
    messages = to_langchain_messages(req)
    async for chunk in llm.astream(messages):
        piece = content_to_text(chunk.content)
        if piece:
            yield piece


def _extract_json(text: str) -> dict:
    """从模型输出中稳健地提取 JSON 对象。"""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError(f"模型输出无法解析为 JSON: {exc}") from exc
    raise ValueError("模型输出中未找到 JSON 对象")


def extract_json(text: str) -> dict:
    """公开的 JSON 提取工具：从模型输出中稳健地提取 JSON 对象。"""
    return _extract_json(text)


# 病历结构化字段（与 MedicalRecordCreateIn / 前端 MedicalRecordPayload 一致）
_MEDICAL_FIELDS = (
    "chief_complaint",
    "present_illness",
    "past_history",
    "allergy_history",
    "drug_allergy_history",
    "family_history",
    "physical_exam",
    "treatment_advice",
    "lab_tests",
    "examinations",
    "treatment",
    "medications",
    "supplements",
    "health_education",
)

_PARSE_SYSTEM_PROMPT = (
    "你是资深临床医学专家，负责把病历资料智能录入结构化电子病历。\n"
    "请严格按以下 JSON 结构输出，不要输出任何额外文字：\n"
    '{"chief_complaint": "...", "present_illness": "...", "past_history": "...", "allergy_history": "...", '
    '"drug_allergy_history": "...", "family_history": "...", "physical_exam": "...", "treatment_advice": "...", '
    '"lab_tests": "...", "examinations": "...", "treatment": "...", "medications": "...", '
    '"supplements": "...", "health_education": "..."}\n'
    "要求：忠实于资料内容逐项识别录入，不要编造或推测；无法确定或缺失的字段填空字符串 \"\"；"
    "输出必须是合法 JSON。"
)


def _normalize_record_fields(data: dict) -> dict:
    """把模型输出规整为 14 个病历字段的字符串字典。"""
    return {field: str(data.get(field, "")).strip() for field in _MEDICAL_FIELDS}


def _normalize_title(text: str) -> str:
    """标题归一化：去书名号/空白/常见标点，便于与知识库标题匹配。"""
    return re.sub(r"[\s《》「」""''。，、·—–()（）-]", "", text or "").lower()


def _attach_document_ids(data: dict, knowledge: list[dict] | None) -> dict:
    """把模型输出的 evidence 与知识库命中项按标题匹配，补上 document_id。

    仅信任 knowledge 中真实存在的文档 ID（不采信模型编造的 ID），
    匹配不上时保留原样，前端据此决定是否展示「查看原文」。
    """
    evidence = data.get("evidence") or []
    if not evidence or not knowledge:
        return data
    index: list[tuple[str, int, str]] = []
    for k in knowledge:
        doc_id = k.get("document_id")
        title = _normalize_title(str(k.get("title", "")))
        if doc_id and title:
            index.append((title, doc_id, str(k.get("content", ""))[:200]))
    if not index:
        return data
    for item in evidence:
        if not isinstance(item, dict):
            continue
        source = _normalize_title(str(item.get("source", "")))
        if not source:
            continue
        for title, doc_id, content in index:
            if source in title or title in source:
                if not item.get("document_id"):
                    item["document_id"] = doc_id
                # 命中片段快照：落库后历史详情可回看检索原文（仅首次匹配填充）
                if not item.get("snippet") and content.strip():
                    item["snippet"] = content
                break
                break
    return data


async def parse_record_text(
    text: str, provider: AIProviderConfig | None = None
) -> dict:
    """解析病历文本：PDF/Word 提取的文本 → 结构化病历字段。"""
    if not text.strip():
        raise AppError("未提取到可识别的文本内容", code="MED_DOC_EMPTY")
    provider = provider or get_active_ai()
    llm = get_llm(temperature=0.1, provider=provider)
    resp = await llm.ainvoke(
        [
            SystemMessage(content=_PARSE_SYSTEM_PROMPT),
            HumanMessage(content=f"病历资料文本：\n{text[:12000]}"),
        ]
    )
    raw = content_to_text(resp.content)
    return _normalize_record_fields(_extract_json(raw))


async def parse_record_image(
    image_bytes: bytes,
    mime_type: str,
    provider: AIProviderConfig | None = None,
) -> dict:
    """解析病历图片：直接以多模态（vision）方式让提供商识别图片并输出结构化字段。"""
    provider = provider or get_active_ai()
    llm = get_llm(temperature=0.1, provider=provider)
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    resp = await llm.ainvoke(
        [
            SystemMessage(content=_PARSE_SYSTEM_PROMPT),
            HumanMessage(
                content=[
                    {"type": "text", "text": "请识别并录入下方病历图片中的内容："},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ]
            ),
        ]
    )
    raw = resp.content if isinstance(resp.content, str) else str(resp.content)
    return _normalize_record_fields(_extract_json(raw))


def extract_pdf_text(data: bytes) -> str:
    """从 PDF 字节流提取文本（pypdf）。扫描件将返回空串。"""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise AppError("服务器缺少 pypdf 依赖，无法解析 PDF 文件", code="MED_DOC_PARSE_FAILED") from exc
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "") for page in reader.pages]
    except Exception as exc:  # noqa: BLE001
        raise AppError("PDF 解析失败，文件可能已损坏或加密", code="MED_DOC_PARSE_FAILED") from exc
    return "\n".join(pages).strip()


def extract_word_text(data: bytes) -> str:
    """从 Word 字节流提取文本（python-docx），含表格内容。"""
    try:
        from docx import Document
    except ImportError as exc:  # pragma: no cover
        raise AppError("服务器缺少 python-docx 依赖，无法解析 Word 文件", code="MED_DOC_PARSE_FAILED") from exc
    try:
        doc = Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                parts.append(" | ".join(cell.text.strip() for cell in row.cells))
    except Exception as exc:  # noqa: BLE001
        raise AppError("Word 文档解析失败，文件可能已损坏", code="MED_DOC_PARSE_FAILED") from exc
    return "\n".join(parts).strip()


async def analyze_record(
    text: str,
    analysis_type: str,
    provider: AIProviderConfig | None = None,
    knowledge: list[dict] | None = None,
) -> dict:
    """病历分析：让当前提供商输出结构化 JSON。

    `knowledge` 为可选的本地知识库命中片段（[{title, content, score}]），
    非空时注入提示词并要求模型在 evidence 中引用来源；
    为空时输出格式与行为同既有契约完全一致。
    """
    type_guide = {
        "record": "对病历进行结构化整理：提取 主诉/现病史/既往史/初步诊断 等要点。",
        "medication": "针对病历中的用药方案进行审核：检查适应证、剂量、相互作用与配伍禁忌。",
        "risk": "评估病历中的风险因素：高危指标、并发症风险、需要重点关注的事项。",
        "exam": "解读病历中的检验检查结果：异常指标、临床意义与建议。",
    }
    guide = type_guide.get(analysis_type, type_guide["record"])

    system = (
        "你是资深临床医学专家，负责病历智能分析。请严格按以下 JSON 结构输出，不要输出任何额外文字：\n"
        '{"summary": {"主诉": "...", "现病史": "...", "既往史": "...", "初步诊断": "..."},'
        ' "attention": [{"title": "关注点标题", "description": "说明与建议", "level": "高|中|低"}],'
        ' "evidence": [{"source": "依据来源", "relevance": 90}]}\n'
        "要求：summary 覆盖病历关键信息；attention 给出 2-5 条优先级关注点，"
        "level 取值为 高/中/低；evidence 给出 1-3 条循证依据（如指南、共识名称）与相关度百分比。"
    )
    if knowledge:
        refs = "\n".join(
            f"- 《{k.get('title', '')}》[文档#{k.get('document_id')}]（相关度 {k.get('score', 0)}）："
            f"{str(k.get('content', ''))[:200]}"
            for k in knowledge
        )
        system += (
            "\n\n以下为本机构知识库检索到的参考依据（可能与病历相关，也可能不相关）：\n"
            f"{refs}\n"
            "要求：evidence 中优先引用上述参考依据中的指南/文献名称作为 source，"
            "且必须使用其完整标题原文（含书名号），不要改写；并给出合理相关度；"
            "若参考依据与本次分析无关可忽略。"
        )

    provider = provider or get_active_ai()
    llm = get_llm(temperature=0.2, provider=provider)
    model = provider.model
    resp = await llm.ainvoke(
        [SystemMessage(content=system), HumanMessage(content=f"{guide}\n\n病历原文：\n{text}")]
    )
    raw = content_to_text(resp.content)
    data = _extract_json(raw)
    data = _attach_document_ids(data, knowledge)
    return {"result": data, "model": model}
