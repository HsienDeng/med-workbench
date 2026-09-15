"""LLM 语义切分与摘要服务：上传文档时按章节/语义边界切块、生成文档摘要，失败自动回退。

与服务 A 的实现保持同一套算法（健康度校验 / 回退策略 / 提示词），
仅将 LLM 调用从 langchain 封装替换为 app.clients.llm_client 直连。
"""

import json
import logging
import re
import unicodedata
from dataclasses import dataclass

from app.config import settings
from app.clients.llm_client import chat_completion

logger = logging.getLogger(__name__)

# 每块目标字数区间（与 bge 模型 512 token 上限大致匹配，中文约 1.5-2 字/token）
_MIN_CHUNK_CHARS = 120
_MAX_CHUNK_CHARS = 800

# 输出健康度阈值：CJK（中日韩）字符在文本里的最低占比。
# 低于阈值视为"模型把原文当 hex/base64/Unicode 转义重排"，整体回退规则切分。
_CJK_MIN_RATIO = 0.30


@dataclass
class Chunk:
    """切分结果块：title 为章节/主题标题（可为空），content 为正文。"""

    title: str
    content: str


_CJK_RANGES = (
    (0x4E00, 0x9FFF),    # CJK Unified Ideographs
    (0x3400, 0x4DBF),    # CJK Extension A
    (0x20000, 0x2A6DF),  # CJK Extension B
    (0xF900, 0xFAFF),    # CJK Compatibility Ideographs
)


def _is_cjk(ch: str) -> bool:
    if not ch:
        return False
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in _CJK_RANGES)


def _cjk_ratio(text: str) -> float:
    """计算文本中 CJK 字符的占比（含全角符号/中文标点不计入）。"""
    meaningful = [c for c in text if not c.isspace()]
    if not meaningful:
        return 0.0
    cjk = sum(1 for c in meaningful if _is_cjk(c))
    return cjk / len(meaningful)


def _looks_garbled(text: str) -> bool:
    """粗判模型输出是否"乱码化"：含大量 hex/Unicode 转义形式/PDF 风格编码。"""
    if not text:
        return False
    # Python 风格 Unicode 转义连续出现：\u4e00 这种 6 字符片段
    if len(re.findall(r"\\u[0-9a-fA-F]{4}", text)) >= 8:
        return True
    # PDF 风格的 hex 编码：/G41/G42 这种连续短码
    if len(re.findall(r"/[0-9A-F]{2,3}/", text)) >= 10:
        return True
    return False


def _chunk_is_healthy(text: str) -> bool:
    """单块切分结果是否可用：CJK 占比达标，且未检出明显的乱码特征。"""
    stripped = text.strip()
    if not stripped:
        return False
    if _looks_garbled(stripped):
        return False
    return _cjk_ratio(stripped) >= _CJK_MIN_RATIO


_CHUNK_SYSTEM_PROMPT = (
    "你是医学文档切分助手。请把用户提供的文档正文按章节、段落与语义边界切分为若干完整、自洽的文本块。\n"
    "要求：\n"
    f"1. 每块字数控制在 {_MIN_CHUNK_CHARS}~{_MAX_CHUNK_CHARS} 字之间；\n"
    "2. 保持章节、段落、列表完整，不要拆分表格、药品清单、数值范围等语义单元；\n"
    "3. 若原文按章、节、条组织，优先以这些标题为切分边界；\n"
    "4. 为每个文本块给出简洁标题（如章节名或主题，不超过 30 字），无标题的段落可用主题概括；\n"
    "5. 只输出 JSON 数组，数组元素为 {\"title\": \"标题\", \"content\": \"正文\"}，不要输出任何其他文字、解释或代码块标记。\n"
    "6. 【关键】content 必须原样复制原文中的中文字符，**不要**将中文转为 \\uXXXX Unicode 转义、"
    "十六进制（hex）编码、Base64 编码或任何其它编码形式，输出必须是可读的中文字符本身。"
)

_SUMMARY_SYSTEM_PROMPT = (
    "你是医学文档摘要助手。请为医学文档生成一段中文摘要，概括文档的主题、适用范围与核心要点。\n"
    "要求：\n"
    "1. 100~200 字；\n"
    "2. 只输出摘要正文，不要输出标题、解释或任何标记；\n"
    "3. 面向临床用户，突出可操作的关键信息（诊断要点、治疗原则、使用规范等）。"
)


def _batch_by_paragraphs(text: str, max_chars: int) -> list[str]:
    """按段落分批，保证单批不超过 max_chars，避免超出模型上下文窗口。"""
    paras = [p for p in re.split(r"\n+", text) if p.strip()]
    if not paras:
        return [text]
    batches: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for p in paras:
        if cur and cur_len + len(p) > max_chars:
            batches.append("\n".join(cur))
            cur, cur_len = [], 0
        cur.append(p)
        cur_len += len(p) + 1
    if cur:
        batches.append("\n".join(cur))
    return batches


def _parse_chunks(raw: str) -> list[Chunk] | None:
    """从模型输出解析切分结果；兼容对象数组与纯字符串数组，失败返回 None。

    健康度校验：每块必须以中文字符为主，未通过则整批作废（返回 None），
    让调用方走 split_text 规则切分，避免把 hex/base64/Unicode 转义乱码写入知识库。
    """
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    text = text.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("["), text.rfind("]")
        if start == -1 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(data, list):
        return None

    chunks: list[Chunk] = []
    for item in data:
        if isinstance(item, dict):
            content = str(item.get("content", "")).strip()
            title = str(item.get("title", "")).strip()
        elif isinstance(item, str):
            content = item.strip()
            title = ""
        else:
            continue
        if not content:
            continue
        if not title:
            # 无标题时取首行/首句作为标题
            first_line = next(
                (l.strip() for l in content.splitlines() if l.strip()), ""
            )
            title = (first_line[:30]) if first_line else f"文本块 {len(chunks) + 1}"
        chunks.append(Chunk(title=title[:80], content=content))
    if not chunks:
        return None

    # 健康度校验：任一块不达标视为整批 LLM 输出无效，回退规则切分
    bad = [c for c in chunks if not _chunk_is_healthy(c.content)]
    if bad:
        sample = bad[0].content[:60].replace("\n", " ")
        logger.warning(
            "LLM 切分输出疑似乱码（%d/%d 块不健康），回退规则切分；样例：%s",
            len(bad), len(chunks), sample,
        )
        return None
    return chunks


def llm_chunk_text(text: str) -> list[Chunk] | None:
    """调用配置的 OpenAI 兼容提供商按章节/语义切分；任何失败/无效输出都返回 None（由调用方回退）。"""
    batches = _batch_by_paragraphs(text, settings.llm_chunk_max_input)
    chunks: list[Chunk] = []
    try:
        for i, batch in enumerate(batches):
            raw = chat_completion(
                _CHUNK_SYSTEM_PROMPT,
                f"（第 {i + 1}/{len(batches)} 批，只输出本批切分结果）\n\n{batch}",
                temperature=0.1,
            )
            parsed = _parse_chunks(raw)
            if parsed is None:
                logger.warning("LLM 切分第 %s/%s 批输出无效，回退规则切分", i + 1, len(batches))
                return None
            chunks.extend(parsed)
    except Exception as exc:  # noqa: BLE001 - 网络/限流/凭证等异常一律回退
        logger.warning("LLM 切分失败：%s，回退规则切分", exc)
        return None

    if not chunks:
        return None
    logger.info("LLM 切分成功：共 %d 批，产出 %d 块", len(batches), len(chunks))
    return chunks


def summarize_text(text: str) -> str | None:
    """调用配置的 OpenAI 兼容提供商生成文档摘要（≤200 字）；失败返回 None，不中断上传。"""
    sample = text[:6000]
    try:
        summary = chat_completion(
            _SUMMARY_SYSTEM_PROMPT,
            f"请为以下医学文档生成摘要：\n\n{sample}",
            temperature=0.2,
        )
        summary = summary.strip()
        if len(summary) > 500:
            summary = summary[:500]
        return summary or None
    except Exception as exc:  # noqa: BLE001 - 摘要失败不阻塞上传
        logger.warning("LLM 摘要生成失败：%s", exc)
        return None


def split_text(text: str, chunk_size: int | None = None, overlap: int | None = None) -> list[Chunk]:
    """规则切分（回退方案）：按句子边界与字符数切分，标题取块首句。"""
    chunk_size = chunk_size or settings.chunk_size
    overlap = overlap or settings.chunk_overlap

    sentences = re.split(r"(?<=[。！？；])\s*|\n+", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    chunks: list[Chunk] = []
    cur = ""
    for sent in sentences:
        if cur and len(cur) + len(sent) > chunk_size:
            if len(sent) > chunk_size and not cur:
                for i in range(0, len(sent), chunk_size - overlap):
                    piece = sent[i : i + chunk_size]
                    chunks.append(Chunk(title=_auto_title(piece), content=piece))
            else:
                chunks.append(Chunk(title=_auto_title(cur), content=cur))
                keep = cur[-overlap:] if overlap else ""
                cur = keep + sent
        else:
            cur += sent
    if cur:
        chunks.append(Chunk(title=_auto_title(cur), content=cur))
    return chunks


def _auto_title(text: str) -> str:
    first_line = next((l.strip() for l in text.splitlines() if l.strip()), "")
    if first_line:
        return first_line[:30]
    return text.strip()[:30] or "文本块"
