"""LangGraph 对话 Agent 服务：/api/chat 与 /api/chat/stream 的 Agent 化实现。

图结构（StateGraph）：
    START → safety_in ─(危险内容)→ safety_out
                    └─(正常)─→ agent ─(工具调用)→ tools → agent
                                 └─(无工具)→ safety_out → END

要点：
- 会话记忆：MySQL 持久化 checkpointer（langgraph-checkpoint-mysql）以
  thread_id = "user:{user.id}" 存储，跨进程重启保留；初始化失败自动降级
  InMemorySaver（进程内存）。输入仅取最新一条 user 消息，历史由 checkpointer 恢复。
- 工具 1：search_knowledge_base —— HTTP 调用 RAG 服务（服务 B）本地知识库检索；
- 工具 2：search_ima_knowledge —— 调用 IMA 外部知识库（保留在服务 A）；
- 工具 3：save_ima_note —— 保存 IMA 笔记。IMA 未配置时不注册工具 2/3。
- LLM 推理沿用 llm.get_llm，由 ai_provider 从数据库动态切换（无需重启）。
- 安全节点：safety_in 校验危险内容（命中则跳过 LLM），safety_out 追加医疗免责声明。

注意：langgraph 为延迟 import（函数内），保证本模块被 import 时不依赖 langgraph 已安装。
"""

import asyncio
import logging
import re
import threading
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool

from app.models import RbacUser
from app.schemas.chat import ChatRequest
from app.services import rag_proxy
from app.clients import llm
from app.clients.llm import content_to_text, reasoning_to_text
from app.clients.ima_client import get_ima_client

logger = logging.getLogger(__name__)

# 医疗免责声明：safety_out 节点统一追加，保障输出合规
MEDICAL_DISCLAIMER = (
    "（以上内容由 AI 生成，仅供参考，不构成诊疗建议；实际诊疗请以临床医生意见为准。）"
)

_DEFAULT_AGENT_IDENTITY = "你是 MedAI Workbench 的医疗 AI 助手（Agent），服务于医疗机构用户。"

_AGENT_RULES_PROMPT = (
    "你可以调用以下工具获取循证依据后再作答：\n"
    "1. search_knowledge_base：检索本机构本地医学知识库（指南/文献/药品/病例/规范等）；\n"
    "2. search_ima_knowledge：检索外部 IMA 医学知识库；\n"
    "3. save_ima_note：把内容保存为 IMA 笔记（仅在用户明确要求保存/收藏时使用）。\n"
    "回答须专业、严谨、结构化；涉及具体诊疗建议时，应先检索知识库获取依据，"
    "并提示内容仅供参考、需经临床医生审核。\n"
    "输出格式要求：正文使用标准 Markdown；列表项、标题必须独占一行（以换行开头），"
    "不要用空格替代换行；中文文字之间不要插入空格；"
    "代码块使用 ``` 围栏并标注语言。"
)

_DEFAULT_AGENT_SYSTEM_PROMPT = _DEFAULT_AGENT_IDENTITY + _AGENT_RULES_PROMPT

# 输入安全校验：命中以下危险模式直接拒绝并引导求助，不调用 LLM
_BLOCKED_KEYWORDS = (
    "自杀方法", "怎么自杀", "如何自杀", "自尽方法", "结束自己生命",
    "跳楼", "上吊", "割腕", "服毒自杀", "安眠药自杀", "自杀方式", "教我自杀",
)

_SAFETY_REPLY = (
    "非常抱歉，我无法协助此类请求。如果您或您身边的人正经历心理困扰，"
    "请及时联系专业医疗机构，或拨打全国心理援助热线 12356 寻求帮助。"
)

# 知识库工具输出中的文档引用格式：《标题》[文档#123]（相关度 0.85）
_CITATION_RE = re.compile(r"《(.+?)》\[文档#(\d+)\]（相关度 ([\d.]+)）(.{0,200})")


def _collect_citations(text: str, acc: dict[int, dict]) -> None:
    """从工具输出文本中提取知识库引用（按 document_id 去重，保留最高相关度）。"""
    for match in _CITATION_RE.finditer(text):
        title, doc_id_raw, score_raw, snippet = match.groups()
        doc_id = int(doc_id_raw)
        try:
            score = float(score_raw)
        except ValueError:
            score = 0.0
        item = {
            "document_id": doc_id,
            "title": title,
            "score": round(score, 4),
            "snippet": snippet.strip()[:200],
        }
        prev = acc.get(doc_id)
        if prev is None or item["score"] > prev["score"]:
            acc[doc_id] = item


def _tools_messages(data: Any) -> list[str]:
    """从 astream updates 的 tools 节点更新中取出 ToolMessage 文本。"""
    if not isinstance(data, dict):
        return []
    node_state = data.get("tools")
    if not isinstance(node_state, dict):
        return []
    texts: list[str] = []
    for m in node_state.get("messages") or []:
        text = content_to_text(getattr(m, "content", ""))
        if text:
            texts.append(text)
    return texts


def _append_messages(
    left: list[BaseMessage] | None, right: list[BaseMessage] | None
) -> list[BaseMessage]:
    """消息 reducer：顺序追加，并把相邻的纯文本 AIMessageChunk 合并为一条。

    agent_node 用 model.astream 逐 token 产出 AIMessageChunk，若直接 list 拼接，
    后续节点（如 safety_out 取最后一条消息）只能看到最后一个 token 而非完整回复；
    故在此合并。有 tool_call_chunks 的 chunk 不合并（保持工具调用消息独立）。
    放在本模块以避免顶层依赖 langgraph（langgraph 仅在函数内延迟导入）。
    """
    if not left:
        return list(right or [])
    if not right:
        return list(left)
    out: list[BaseMessage] = list(left)
    for msg in right:
        prev = out[-1]
        if (
            isinstance(prev, AIMessageChunk)
            and isinstance(msg, AIMessageChunk)
            and not prev.tool_call_chunks
            and not msg.tool_call_chunks
        ):
            # content 可能是 str，也可能是网关返回的块列表（见 llm.content_to_text）
            out[-1] = AIMessageChunk(content=content_to_text(prev.content) + content_to_text(msg.content))
        else:
            out.append(msg)
    return out


def _sanitize_tool_history(messages: list[BaseMessage]) -> list[BaseMessage]:
    """清理消息历史中的工具调用脏数据（双向）。

    OpenAI 兼容服务对消息历史要求严格，两类脏数据都会导致 400：

    1. assistant 消息声明了 tool_calls，但后续没有对应的 ToolMessage
       （工具执行结果）→ "No tool output found for function call ..."；
    2. ToolMessage 存在，但历史中没有声明该 call_id 的 tool_call
       → "No tool call found for function call output with call_id ..."。

    脏数据来源：生成器节点逐 token yield 时，若在工具调用中途发生异常/
    进程重启，持久化 checkpoint 可能残留半截消息（只剩工具调用声明、或
    工具已执行但调用消息丢失）。下次请求恢复历史后，需双向清洗：

    - 把 AIMessageChunk 收敛为 AIMessage（去掉 tool_call_chunks 残片）；
    - 丢弃"无对应 ToolMessage"的 tool_call（保留文本；无文本则整条丢弃）；
    - 丢弃"无对应 tool_call 声明"的孤立 ToolMessage。
    """
    # 1. 收敛流式 chunk 为完整消息
    normalized: list[BaseMessage] = []
    for m in messages:
        if isinstance(m, AIMessageChunk):
            m = AIMessage(
                content=content_to_text(m.content),
                additional_kwargs=m.additional_kwargs,
                id=m.id,
            )
        normalized.append(m)

    # 2. 收集所有工具执行结果 id
    tool_output_ids = {
        m.tool_call_id for m in normalized if isinstance(m, ToolMessage) and m.tool_call_id
    }

    # 3. 过滤 assistant 消息的孤立 tool_call（无对应执行结果）
    kept: list[BaseMessage] = []
    for m in normalized:
        if isinstance(m, AIMessage) and m.tool_calls:
            valid = [tc for tc in m.tool_calls if tc.get("id") in tool_output_ids]
            if len(valid) == len(m.tool_calls):
                kept.append(m)
            elif valid:
                kept.append(
                    AIMessage(content=m.content, tool_calls=valid, additional_kwargs=m.additional_kwargs)
                )
            elif m.content:
                kept.append(AIMessage(content=m.content, additional_kwargs=m.additional_kwargs))
            # 无有效 tool_calls 且无文本：整条丢弃
        else:
            kept.append(m)

    # 4. 收集最终保留的有效 tool_call id，删除孤立的 ToolMessage
    valid_call_ids = {
        tc["id"]
        for m in kept
        if isinstance(m, AIMessage)
        for tc in (m.tool_calls or [])
        if tc.get("id")
    }
    return [
        m
        for m in kept
        if not (isinstance(m, ToolMessage) and m.tool_call_id not in valid_call_ids)
    ]


class AgentState(TypedDict):
    """Agent 图状态：messages 由 _append_messages 累加，其余字段覆盖式更新。"""

    messages: Annotated[list[BaseMessage], _append_messages]
    system_prompt: str | None
    blocked: str | None
    final_text: str | None


def _check_input_safety(text: str) -> str | None:
    """命中危险关键词返回安全回复文本，否则 None。"""
    for keyword in _BLOCKED_KEYWORDS:
        if keyword in text:
            return _SAFETY_REPLY
    return None


def _last_user_content(req: ChatRequest) -> str:
    for m in reversed(req.messages):
        if m.role == "user":
            return m.content
    return ""


# ---------- 工具定义 ----------

def _make_tools(hospital_id: int) -> list:
    """按租户构建工具：hospital_id 闭包注入，保证多租户数据隔离。"""

    @tool("search_knowledge_base")
    async def search_knowledge_base(q: str, limit: int = 5) -> str:
        """检索本机构本地医学知识库（指南/文献/药品/病例/规范等），返回相关文档片段。

        参数：
        - q: 检索关键词（如"肺结核治疗"）
        - limit: 返回条数，默认 5
        """
        try:
            body = await rag_proxy.search(hospital_id=hospital_id, q=q, limit=limit)
        except Exception as exc:  # noqa: BLE001
            logger.warning("rag search tool 失败: %s", exc)
            return f"本地知识库检索失败：{exc}"
        hits = body.get("hits") or []
        if not hits:
            return "本地知识库未检索到相关内容。"
        return "\n".join(
            f"[{i}]《{h['title']}》[文档#{h.get('document_id')}]（相关度 {h.get('score', 0)}）"
            f"{h['content'][:200]}"
            for i, h in enumerate(hits, 1)
        )

    @tool("search_ima_knowledge")
    async def search_ima_knowledge(q: str, kb_name: str | None = None, limit: int = 3) -> str:
        """检索外部 IMA 医学知识库，返回相关文档标题与片段。

        参数：
        - q: 检索关键词
        - kb_name: 限定知识库名称（可选）
        - limit: 返回条数，默认 3
        """
        client = get_ima_client()
        if not client.configured:
            return "IMA 外部知识库未配置。"
        try:
            raw = await client.search_knowledge(query=q, kb_name=kb_name, limit=limit)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ima search tool 失败: %s", exc)
            return f"IMA 检索失败：{exc}"
        hits = [h for h in raw or [] if isinstance(h, dict)]
        if not hits:
            return "IMA 知识库未检索到相关内容。"
        return "\n".join(
            f"[{i}]《{h.get('title', '')}》{str(h.get('snippet', ''))[:200]}"
            for i, h in enumerate(hits, 1)
        )

    @tool("save_ima_note")
    async def save_ima_note(title: str, content: str) -> str:
        """把内容保存为 IMA 笔记，返回笔记 ID。

        仅在用户明确要求“保存 / 收藏 / 记录到 IMA”时调用，不要主动保存。
        正文用 Markdown；本地图片引用会被自动剔除。

        参数：
        - title: 笔记标题
        - content: 笔记正文（Markdown）
        """
        client = get_ima_client()
        if not client.configured:
            return "IMA 笔记保存失败：未配置 IMA 凭证。"
        try:
            note_id = await client.save_note(title=title, content=content)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ima save note tool 失败: %s", exc)
            return f"IMA 笔记保存失败：{exc}"
        return f"已保存为 IMA 笔记（note_id={note_id}）。"

    # IMA 未配置时不注册相关工具（配置视为管理员对数据出网的授权）
    ima_client = get_ima_client()
    tools = [search_knowledge_base]
    if ima_client.configured:
        tools.extend([search_ima_knowledge, save_ima_note])
    return tools


# ---------- 图构建（checkpointer / graph 均跨请求复用） ----------

_checkpointer: Any = None
_checkpointer_lock = asyncio.Lock()
_graphs: dict[tuple[int, str | None], Any] = {}
_graphs_lock = threading.Lock()


async def _get_checkpointer() -> Any:
    """获取/初始化持久化 checkpointer（跨请求复用）。

    优先 MySQL 持久化（langgraph-checkpoint-mysql + aiomysql 连接池），
    保证会话记忆跨进程重启保留；初始化失败时降级为进程内存 InMemorySaver
    并记录警告（此时记忆不持久，仅作兜底）。
    """
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer
    async with _checkpointer_lock:
        if _checkpointer is not None:
            return _checkpointer
        try:
            import aiomysql

            from app.config import settings
            from app.services.checkpoint_saver import PrefixedAIOMySQLSaver

            pool = await aiomysql.create_pool(
                host=settings.db_host,
                port=settings.db_port,
                user=settings.db_user,
                password=settings.db_password,
                db=settings.db_name,
                autocommit=True,
                charset="utf8mb4",
                minsize=1,
                maxsize=5,
            )
            saver = PrefixedAIOMySQLSaver(conn=pool)
            await saver.setup()  # 建表：med_checkpoints / med_checkpoint_blobs / med_checkpoint_writes
            _checkpointer = saver
            logger.info(
                "Agent 会话记忆持久化已启用（MySQL %s@%s:%s/%s）",
                settings.db_user,
                settings.db_host,
                settings.db_port,
                settings.db_name,
            )
        except Exception as exc:  # noqa: BLE001
            from langgraph.checkpoint.memory import InMemorySaver

            logger.warning(
                "MySQL 会话记忆初始化失败，降级为进程内存 InMemorySaver（重启丢失）：%s",
                exc,
            )
            _checkpointer = InMemorySaver()
    return _checkpointer


async def _build_graph(hospital_id: int, model: str | None = None):
    """按 (hospital_id, model) 构建/复用编译后的 Agent 图（工具闭包绑定该租户）。"""
    cache_key = (hospital_id, model or None)
    with _graphs_lock:
        if cache_key in _graphs:
            return _graphs[cache_key]

    from langgraph.graph import END, START, StateGraph
    from langgraph.prebuilt import ToolNode, tools_condition

    tools = _make_tools(hospital_id)
    # 部分推理模型只接受 temperature=1；get_llm 已自动处理
    llm_client = llm.get_llm(temperature=0.3, model=model)
    graph_model = llm_client.bind_tools(tools)

    async def safety_in(state: AgentState) -> AgentState:
        """输入安全校验：命中危险内容则注入安全回复并跳过 LLM。"""
        blocked: str | None = None
        for m in reversed(state["messages"]):
            if isinstance(m, HumanMessage):
                blocked = _check_input_safety(content_to_text(m.content))
                break
        if blocked:
            return {"blocked": blocked, "messages": [AIMessage(content=blocked)]}
        return {"blocked": None}

    async def agent_node(state: AgentState):
        """LLM 推理节点：注入系统提示（含工具说明）后流式调用模型。

        langgraph 1.x 生成器节点：每次 yield 的更新仅作为 stream_mode="messages"
        的逐 token 输出，最终 state 只保留最后一次 yield。因此：
        - 中间 yield 每个 AIMessageChunk 供前端流式渲染；
        - 最后一次 yield 完整 AIMessage，保证 safety_out 能取到完整回复。
        """
        sys_prompt = compose_system_prompt(state.get("system_prompt"))
        messages = [SystemMessage(content=sys_prompt)] + _sanitize_tool_history(list(state["messages"]))
        full_chunk: AIMessageChunk | None = None
        async for chunk in graph_model.astream(messages):
            # AIMessageChunk 的 + 合并 content 与 tool_call_chunks（工具调用参数跨 chunk 累积）
            full_chunk = chunk if full_chunk is None else full_chunk + chunk
            yield {"messages": [chunk]}
        if full_chunk is not None:
            # 最后一次 yield 写回完整消息（含 tool_calls），保证 tools_condition 可路由、
            # safety_out 可拿到完整回复（langgraph 1.x 生成器节点最终 state 取最后一次 yield）
            yield {"messages": [full_chunk]}

    def safety_out(state: AgentState) -> AgentState:
        """输出节点：取最终 AI 回复并追加医疗免责声明。"""
        final = ""
        for m in reversed(state["messages"]):
            if isinstance(m, AIMessage) and not m.tool_calls:
                final = content_to_text(m.content)
                break
        text = (final + "\n\n" + MEDICAL_DISCLAIMER) if final else MEDICAL_DISCLAIMER
        return {"final_text": text}

    def route_from_safety(state: AgentState) -> str:
        return "safety_out" if state.get("blocked") else "agent"

    builder = StateGraph(AgentState)
    builder.add_node("safety_in", safety_in)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", ToolNode(tools))
    builder.add_node("safety_out", safety_out)
    builder.add_edge(START, "safety_in")
    builder.add_conditional_edges(
        "safety_in",
        route_from_safety,
        {"agent": "agent", "safety_out": "safety_out"},
    )
    builder.add_conditional_edges(
        "agent",
        tools_condition,
        {"tools": "tools", END: "safety_out"},
    )
    builder.add_edge("tools", "agent")
    builder.add_edge("safety_out", END)

    graph = builder.compile(checkpointer=await _get_checkpointer())
    with _graphs_lock:
        _graphs[cache_key] = graph
    return graph


def _thread_config(user: RbacUser) -> dict:
    return {"configurable": {"thread_id": f"user:{user.id}"}}


def compose_system_prompt(custom: str | None) -> str:
    """组合系统提示词：角色模板身份在前，工具/格式规则在后。

    custom 为空时返回默认提示词，保证旧请求行为不变；
    custom 存在时以其为第一身份（替换默认身份句），并明确声明角色设定优先，
    避免模型仍以"通用医疗 AI 助手"自居；工具调用与 Markdown 格式约束保留。
    """
    text = (custom or "").strip()
    if not text:
        return _DEFAULT_AGENT_SYSTEM_PROMPT
    return (
        "# 角色设定（最高优先级，以此身份进行自我介绍与作答）\n"
        + text
        + "\n\n# 平台通用规则\n"
        + _AGENT_RULES_PROMPT
    )


def _build_input(req: ChatRequest) -> dict:
    return {
        "messages": [HumanMessage(content=_last_user_content(req))],
        "system_prompt": req.system_prompt,
        "blocked": None,
        "final_text": None,
    }


# ---------- 对外接口 ----------

async def chat_once(req: ChatRequest, user: RbacUser) -> tuple[str, list[dict]]:
    """Agent 非流式对话，返回 (最终回复文本, 知识库引用列表)。

    注意：不能使用 graph.ainvoke —— 生成器节点（agent_node 逐 token 产出）
    在 langgraph 1.x 的 ainvoke 下只保留最后一次 yield，会丢失回复内容；
    故统一走 astream 聚合（生成器节点的官方支持场景）。
    """
    graph = await _build_graph(user.hospital_id or 1, req.model)
    input_ = _build_input(req)
    cfg = _thread_config(user)
    pieces: list[str] = []
    final_text = ""
    citations: dict[int, dict] = {}
    async for mode, data in graph.astream(input_, cfg, stream_mode=["messages", "updates"]):
        if mode == "messages":
            chunk, meta = data
            if meta.get("langgraph_node") == "agent":
                piece = content_to_text(chunk.content)
                if piece:
                    pieces.append(piece)
        elif mode == "updates":
            for text in _tools_messages(data):
                _collect_citations(text, citations)
            node_state = data.get("safety_out") or {}
            if node_state.get("final_text"):
                final_text = node_state["final_text"]
    if final_text:
        return final_text, list(citations.values())
    return "".join(pieces) or "", list(citations.values())


async def chat_stream(req: ChatRequest, user: RbacUser):
    """Agent 流式对话，逐片 yield 事件 dict（路由层序列化为 SSE JSON 事件）。

    事件类型：
    - ``{"type": "delta", "text": ...}``    最终回复增量
    - ``{"type": "thinking", "text": ...}`` 推理（思考）过程增量，模型/网关支持时才有
    - ``{"type": "citations", "list": [...]}`` 知识库引用（不作为正文渲染）

    [DONE]/[ERROR] 由路由层封装；免责声明文本附在回复末尾的 delta 中。
    """
    graph = await _build_graph(user.hospital_id or 1, req.model)
    input_ = _build_input(req)
    seen = ""
    citations: dict[int, dict] = {}
    async for mode, data in graph.astream(
        input_, _thread_config(user), stream_mode=["messages", "updates"]
    ):
        if mode == "messages":
            chunk, meta = data
            if meta.get("langgraph_node") == "agent":
                think = reasoning_to_text(chunk.content)
                if think:
                    yield {"type": "thinking", "text": think}
                piece = content_to_text(chunk.content)
                if piece:
                    seen += piece
                    yield {"type": "delta", "text": piece}
        elif mode == "updates":
            for text in _tools_messages(data):
                _collect_citations(text, citations)
            node_state = data.get("safety_out") or {}
            final = node_state.get("final_text") or ""
            if final.startswith(seen) and len(final) > len(seen):
                yield {"type": "delta", "text": final[len(seen):]}
                seen = final
    if citations:
        yield {"type": "citations", "list": list(citations.values())}
