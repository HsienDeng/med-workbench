"""IMA（腾讯 ima.qq.com）OpenAPI 客户端。

运行时通过 HTTP 直接调用 IMA OpenAPI（https://ima.qq.com），不依赖 Node
运行时、不读取 skill 文件——SKILL.md 中的接口决策表已在此翻译为 Python 方法。

凭证从 settings 读取（IMA_OPENAPI_CLIENTID / IMA_OPENAPI_APIKEY）：
- 未配置时 configured=False，调用方应避免注册 ima 相关工具；
- 配置后视为管理员对医疗数据出网的授权（见 spec §7.5 / §9）。
"""

from __future__ import annotations

import asyncio
import html as _html
import json
import logging
import re
import time
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, SystemMessage

from app.config import settings
from app.exceptions import ImaApiError, ImaNotConfigured
from app.clients import kimi

logger = logging.getLogger(__name__)

IMA_BASE_URL = "https://ima.qq.com"
IMA_TIMEOUT = httpx.Timeout(30.0)

# 知识库列表缓存 TTL（秒）：检索一次最坏要 3 关键词 × 3 库 = 9 次调用，
# 且每次都要先列库，缓存可避免重复请求与延迟叠加。库列表变动低频，短 TTL 足够。
_KB_CACHE_TTL = 60.0

# 本地图片引用（file:// 或盘符路径），保存笔记前需过滤（医疗内容不应携带本地文件引用）
_LOCAL_IMAGE_MD_RE = re.compile(
    r"!\[[^\]]*\]\((?:file://[^)]*|[A-Za-z]:[\\/][^)]*)\)",
    re.IGNORECASE,
)
_LOCAL_IMAGE_HTML_RE = re.compile(
    r'<img[^>]*src=["\'](?:file://[^"\']*|[A-Za-z]:[\\/][^"\']*)["\'][^>]*>',
    re.IGNORECASE,
)

# ---------- AI 断词（检索关键词提取） ----------
# 短查询直接作为关键词检索，跳过 LLM 调用（低延迟、行为可预期）
_SHORT_QUERY_MAX_CHARS = 6
_MAX_KEYWORDS = 3

_KEYWORD_SYSTEM_PROMPT = (
    "你是医学检索助手，负责把用户的长句查询改写为适合语义检索的短关键词。\n"
    "要求：\n"
    "1. 提取 1~3 个核心实体词（疾病名、指南名、药品名、检查项、手术名等），每个不超过 6 个汉字；\n"
    "2. 去掉“治疗”“诊断”“指南”“方案”“怎么”“如何”等宽泛修饰词，除非它们构成专有名词的一部分；\n"
    "3. 多个实体分别作为数组元素；\n"
    "4. 只输出 JSON 字符串数组，如 [\"肺结核\", \"耐药\"]，不要输出任何解释或代码块标记。"
)

# 规则兜底切分：标点 + 常见连接词/宽泛修饰词
_KEYWORD_SPLIT_RE = re.compile(r"[\s,，。、;；:：/|·]+|(?:的|与|及|和|或|治疗|诊断|指南|方案)")


def _parse_keywords(raw: str) -> list[str]:
    """从模型输出解析关键词数组；失败/无效返回空列表。"""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("["), text.rfind("]")
        if start == -1 or end <= start:
            return []
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    words: list[str] = []
    for item in data:
        word = str(item).strip().strip("\"'")
        if word and 1 <= len(word) <= 8 and word not in words:
            words.append(word)
    return words[: _MAX_KEYWORDS]


def _split_keywords_by_rules(query: str) -> list[str]:
    """规则兜底断词：按标点/连接词切分，保留 ≤8 字片段。"""
    words: list[str] = []
    for part in _KEYWORD_SPLIT_RE.split(query):
        part = part.strip()
        if not part or len(part) > 8:
            continue
        if part not in words:
            words.append(part)
    return words[: _MAX_KEYWORDS]


async def extract_search_keywords(query: str) -> list[str]:
    """AI 断词：把长句查询拆成 1~3 个短检索关键词，提升 IMA 语义检索命中率。

    优先级：LLM 提取 → 规则拆分 → 原 query 兜底。任何失败都不抛异常。
    """
    query = (query or "").strip()
    if not query:
        return []
    if len(query) <= _SHORT_QUERY_MAX_CHARS:
        return [query]

    try:
        llm = kimi.get_llm(temperature=0.1)
        resp = await llm.ainvoke(
            [SystemMessage(content=_KEYWORD_SYSTEM_PROMPT), HumanMessage(content=query)]
        )
        raw = resp.content if isinstance(resp.content, str) else str(resp.content)
        keywords = _parse_keywords(raw)
        if keywords:
            logger.info("AI 断词「%s」→ %s", query, keywords)
            return keywords
    except Exception as exc:  # noqa: BLE001 - 断词失败走规则回退，不中断检索
        logger.warning("AI 断词提取失败：%s，回退规则拆分", exc)

    fallback = _split_keywords_by_rules(query)
    return fallback or [query]


def strip_local_image_refs(content: str) -> str:
    """移除 Markdown / HTML 中的本地图片引用。"""
    content = _LOCAL_IMAGE_MD_RE.sub("", content)
    content = _LOCAL_IMAGE_HTML_RE.sub("", content)
    return content


def _html_to_text(html: str) -> str:
    """HTML → 纯文本（不引第三方依赖，够用于正文预览）。"""
    if not html:
        return ""
    text = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|tr|h[1-6]|li)>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = _html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.strip() for line in text.splitlines()).strip()


def _truncate_text(text: str, max_chars: int) -> tuple[str, bool]:
    """截断过长正文，返回 (文本, 是否被截断)。"""
    if max_chars and len(text) > max_chars:
        return text[:max_chars] + "\n\n……（内容过长，已截断）", True
    return text, False


def _bytes_to_text(data: bytes) -> str:
    """字节 → 文本，按常见中文编码依次尝试。"""
    if not data:
        return ""
    for encoding in ("utf-8", "gb18030", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


# PDF 内部隐藏对象噪声（如 fmx_OtherMirrors 水印标识）：
# 在 PDF 阅读器中不可见，但会被文本提取带出，需过滤，否则正文开头出现无意义串。
_PDF_NOISE_RE = re.compile(r"fmx_[A-Za-z0-9+/=]+")


def _pdf_to_text(data: bytes) -> str:
    """PDF 字节 → 纯文本（逐页提取，单页失败不中断）。"""
    try:
        from io import BytesIO

        import pypdf
    except ImportError:  # pragma: no cover - pypdf 属 RAG 侧依赖，缺失时降级
        logger.warning("pypdf 不可用，PDF 正文无法解析")
        return ""

    try:
        reader = pypdf.PdfReader(BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        logger.warning("PDF 解析失败：%s", exc)
        return ""

    pages: list[str] = []
    for index, page in enumerate(reader.pages, 1):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # noqa: BLE001 - 单页损坏不影响其余页
            logger.warning("PDF 第 %d 页提取失败：%s", index, exc)
            continue
        if text.strip():
            pages.append(text.strip())

    text = "\n\n".join(pages)
    # 移除 PDF 内部隐藏对象噪声，清理因移除产生的连续空行
    text = _PDF_NOISE_RE.sub("", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# 反爬/验证页特征：命中且正文过短时视为无有效内容
_BLOCKED_MARKERS = ("环境异常", "完成验证后即可继续访问", "去验证", "请开启JavaScript", "verify", "captcha")


def _is_blocked_content(text: str) -> bool:
    """判定是否为反爬拦截页（而非真正的正文）。"""
    stripped = text.strip()
    if not stripped:
        return True
    if len(stripped) > 500:
        return False
    return any(marker in stripped for marker in _BLOCKED_MARKERS)


def _extract_text_from_bytes(data: bytes, media_type: int) -> str:
    """按媒体类型把原始字节转成可读纯文本。"""
    if not data:
        return ""
    # PDF 是二进制容器，需专用解析；其他类型按文本处理
    if media_type == 1 or data[:5] == b"%PDF-":
        text = _pdf_to_text(data)
        if text.strip():
            return text
        # 解析失败时回退，避免返回二进制乱码
        return ""
    text = _html_to_text(_bytes_to_text(data))
    # 微信公众文章等可能返回反爬验证页，识别后视为无正文
    if _is_blocked_content(text):
        logger.info("IMA 原文疑似被反爬拦截（%d 字），按无正文处理", len(text.strip()))
        return ""
    return text


def _first(mapping: dict[str, Any], *keys: str) -> Any:
    """按候选键依次取值，返回第一个非空值（IMA 不同接口字段名不一致）。"""
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ""):
            return value
    return None


class ImaClient:
    """IMA OpenAPI HTTP 客户端。"""

    def __init__(self, client_id: str, api_key: str) -> None:
        self._client_id = client_id or ""
        self._api_key = api_key or ""
        # 知识库列表缓存：{(query, limit): (过期时间戳, 结果)}
        self._kb_cache: dict[tuple[str, int], tuple[float, list[dict[str, Any]]]] = {}
        self._kb_cache_lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._client_id.strip() and self._api_key.strip())

    async def _list_knowledge_bases_cached(self, query: str, limit: int) -> list[dict[str, Any]]:
        """带 TTL 缓存的知识库列表查询（并发安全，避免缓存击穿）。"""
        key = (query, limit)
        now = time.monotonic()
        cached = self._kb_cache.get(key)
        if cached is not None and cached[0] > now:
            return list(cached[1])

        async with self._kb_cache_lock:
            # 双检：等待锁期间可能已被其他协程填充
            cached = self._kb_cache.get(key)
            if cached is not None and cached[0] > time.monotonic():
                return list(cached[1])
            result = await self._list_knowledge_bases_uncached(query, limit)
            self._kb_cache[key] = (time.monotonic() + _KB_CACHE_TTL, list(result))
            return list(result)

    def clear_cache(self) -> None:
        """清空知识库列表缓存（配置变更或需要强制刷新时调用）。"""
        self._kb_cache.clear()

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """统一 POST；返回业务 data；code != 0 或网络异常抛 ImaApiError。"""
        if not self.configured:
            raise ImaNotConfigured()

        headers = {
            "Content-Type": "application/json",
            "ima-openapi-clientid": self._client_id,
            "ima-openapi-apikey": self._api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=IMA_TIMEOUT) as client:
                resp = await client.post(f"{IMA_BASE_URL}{path}", headers=headers, json=payload)
                resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ImaApiError(f"IMA 接口 {path} 返回 HTTP {exc.response.status_code}") from exc
        except httpx.HTTPError as exc:
            raise ImaApiError(f"IMA 接口 {path} 网络错误：{exc.__class__.__name__}") from exc

        try:
            body = resp.json()
        except ValueError as exc:
            raise ImaApiError(f"IMA 接口 {path} 返回非 JSON 响应") from exc

        code = body.get("code", -1)
        if code != 0:
            raise ImaApiError(f"IMA 接口 {path} 错误（code={code}）：{body.get('msg', '未知错误')}")
        return body.get("data") or {}

    async def list_knowledge_bases(self, query: str = "", limit: int = 20) -> list[dict[str, Any]]:
        """搜索 IMA 知识库，返回 [{"id", "name"}]（结果按 TTL 缓存）。"""
        limit = max(1, min(int(limit or 20), 20))
        return await self._list_knowledge_bases_cached(query, limit)

    async def _list_knowledge_bases_uncached(self, query: str, limit: int) -> list[dict[str, Any]]:
        """实际调用 IMA 接口（无缓存）。

        注意：IMA search_knowledge_base 的 limit 上限为 20，超出会返回
        code=51（invalid ... Limit），此处强制收敛到合法范围。
        """
        limit = max(1, min(int(limit or 20), 20))
        data = await self._post(
            "/openapi/wiki/v1/search_knowledge_base",
            {"query": query, "cursor": "", "limit": limit},
        )
        infos = data.get("info_list") or []
        result = []
        for item in infos:
            if not isinstance(item, dict):
                continue
            result.append(
                {
                    "id": _first(item, "id", "knowledge_base_id", "kb_id"),
                    "name": _first(item, "kb_name", "name", "knowledge_base_name", "title"),
                    # 知识库类型/角色：用于前端区分「个人/共享/订阅」知识库（订阅库 role_type=普通成员）
                    "base_type": _first(item, "base_type"),
                    "role_type": _first(item, "role_type"),
                    "member_count": int(_first(item, "member_count") or 0),
                    "content_count": int(_first(item, "content_count") or 0),
                }
            )
        return [r for r in result if r["id"]]

    async def search_in_knowledge_base(self, query: str, kb_id: Any) -> list[dict[str, Any]]:
        """在指定知识库中语义检索，返回命中条目列表。"""
        data = await self._post(
            "/openapi/wiki/v1/search_knowledge",
            {"query": query, "cursor": "", "knowledge_base_id": str(kb_id)},
        )
        infos = data.get("info_list") or []
        result = []
        for item in infos:
            if not isinstance(item, dict):
                continue
            result.append(
                {
                    "media_id": _first(item, "media_id", "id"),
                    "title": _first(item, "title", "name"),
                    "snippet": _first(item, "highlight_content", "content", "summary", "description"),
                }
            )
        return result

    async def search_knowledge(self, query: str, kb_name: str | None = None, limit: int = 5) -> list[dict[str, Any]]:
        """检索 IMA 知识库（工具 ima_search 的后端实现）。

        kb_name 指定时先按名称精确匹配定位知识库；否则按 AI 断词后的
        关键词匹配知识库名，再回退到全部知识库（前 3 个）逐个检索，
        合并去重后截断到 limit 条。
        返回 [{"knowledge_base", "title", "snippet", "media_id", "url"}]。
        """
        limit = max(1, min(limit or 5, 20))
        # AI 断词：长句 → 1~3 个短关键词，IMA 语义检索对短词命中率显著更高
        keywords = await extract_search_keywords(query)
        if not keywords:
            return []

        candidates: list[dict[str, Any]] = []
        if kb_name:
            named = [kb for kb in await self.list_knowledge_bases(kb_name, 20) if kb.get("name") == kb_name]
            candidates = named
        if not candidates:
            # 用断词结果匹配知识库名（内容词通常匹配不上库名）
            for kw in keywords:
                candidates = (await self.list_knowledge_bases(kw, 20))[:3]
                if candidates:
                    break
        if not candidates:
            candidates = (await self.list_knowledge_bases("", 20))[:3]

        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        for kw in keywords:
            for kb in candidates:
                for hit in await self.search_in_knowledge_base(kw, kb["id"]):
                    key = str(hit.get("media_id") or hit.get("title"))
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    results.append(
                        {
                            "knowledge_base": kb.get("name"),
                            "title": hit.get("title", ""),
                            "snippet": hit.get("snippet", ""),
                            "media_id": hit.get("media_id"),
                            "url": None,
                        }
                    )
                    if len(results) >= limit:
                        return results
        return results

    async def list_knowledge_contents(self, kb_id: str, folder_id: str | None = None) -> dict[str, Any]:
        """浏览知识库目录（get_knowledge_list）。

        返回 {"items": [...], "current_path": [...]}：
        - items: 目录条目（media_type=99 为文件夹，其余为文件，media_id 可直接用于导航）；
        - current_path: 面包屑，顶层为知识库根（media_id=None），其余节点附带
          media_id=folder_<folder_id> 可直接用于导航。
        """
        payload: dict[str, Any] = {"cursor": "", "limit": 50, "knowledge_base_id": str(kb_id)}
        if folder_id:
            payload["folder_id"] = str(folder_id)
        data = await self._post("/openapi/wiki/v1/get_knowledge_list", payload)

        items: list[dict[str, Any]] = []
        for item in data.get("knowledge_list") or []:
            if not isinstance(item, dict):
                continue
            media_id = str(_first(item, "media_id", "id") or "")
            if not media_id:
                continue
            media_type = int(_first(item, "media_type", "type") or 0)
            items.append(
                {
                    "media_id": media_id,
                    "title": str(_first(item, "title", "name") or ""),
                    "media_type": media_type,
                    "is_folder": media_type == 99,
                    "parent_folder_id": item.get("parent_folder_id"),
                    "file_number": int(_first(item, "file_number") or 0),
                    "folder_number": int(_first(item, "folder_number") or 0),
                }
            )

        current_path: list[dict[str, Any]] = []
        for index, node in enumerate(data.get("current_path") or []):
            if not isinstance(node, dict):
                continue
            # IMA 返回的面包屑节点：根节点 folder_id 无 folder_ 前缀，子节点自带前缀
            folder_id_raw = str(_first(node, "folder_id", "id") or "")
            current_path.append(
                {
                    "folder_id": folder_id_raw,
                    "media_id": folder_id_raw if folder_id_raw and index > 0 else None,
                    "name": str(_first(node, "name", "title") or ""),
                }
            )
        return {"items": items, "current_path": current_path}

    async def save_note(self, title: str, content: str) -> str:
        """把 Markdown 内容保存为 IMA 笔记（工具 ima_save_note 的后端实现）。

        标题以一级标题注入正文（IMA import_doc 无独立 title 参数）；
        写入前过滤本地图片引用。返回 note_id。
        """
        cleaned = strip_local_image_refs(content).strip()
        if title:
            markdown = f"# {title}\n\n{cleaned}".rstrip() if cleaned else f"# {title}"
        else:
            markdown = cleaned
        data = await self._post(
            "/openapi/note/v1/import_doc",
            {"content_format": 1, "content": markdown},
        )
        note_id = _first(data, "note_id", "id")
        if not note_id:
            raise ImaApiError("IMA import_doc 响应缺少 note_id")
        return str(note_id)

    async def get_media_detail(self, media_id: str, max_chars: int = 20000) -> dict[str, Any]:
        """按 media_id 获取媒体详情与正文。

        流程：
        1. get_media_info 拿到访问信息；
        2. 笔记类型（media_type=11）走 note/get_doc_content 直接取纯文本；
        3. 其余类型按 url_info 下载原文并清洗为纯文本。

        返回 {"media_type", "content", "truncated", "url", "note_id"}；
        无法访问时 content 为空字符串（不算失败，由调用方提示）。
        """
        media_id = (media_id or "").strip()
        if not media_id:
            raise ImaApiError("media_id 不能为空")

        try:
            info = await self._post("/openapi/wiki/v1/get_media_info", {"media_id": media_id})
        except ImaApiError as exc:
            # 220030：订阅知识库的文件不对 OpenAPI 开放（平台限制，无法绕过）
            if "220030" in str(exc):
                raise ImaApiError(
                    "IMA 平台限制：订阅知识库的文件不支持通过 OpenAPI 获取原文，"
                    "请在 IMA 客户端中查看（可继续使用目录浏览与语义检索）"
                ) from exc
            raise
        media_type = int(info.get("media_type") or 0)

        # 笔记类型：直接取笔记纯文本
        if media_type == 11:
            ext = info.get("notebook_ext_info") or {}
            note_id = _first(ext, "notebook_id", "note_id") or media_id
            try:
                doc = await self._post(
                    "/openapi/note/v1/get_doc_content",
                    {"note_id": note_id, "target_content_format": 0},
                )
            except (ImaApiError, ImaNotConfigured):
                doc = {}
            content = str(_first(doc, "content", "text") or "")
            content, truncated = _truncate_text(content, max_chars)
            return {
                "media_type": media_type,
                "content": content,
                "truncated": truncated,
                "url": "",
                "note_id": note_id,
            }

        # 其余类型：下载原文
        url_info = info.get("url_info") or {}
        url = str(_first(url_info, "url") or "")
        headers = url_info.get("headers") or {}
        if not url:
            return {
                "media_type": media_type,
                "content": "",
                "truncated": False,
                "url": "",
                "note_id": "",
            }

        try:
            raw_bytes = await self._download_bytes(url, headers)
        except Exception as exc:  # noqa: BLE001 - 下载失败降级为无正文，不中断详情展示
            logger.warning("IMA 原文下载失败 media_id=%s: %s", media_id, exc)
            raw_bytes = b""

        content = _extract_text_from_bytes(raw_bytes, media_type)
        content, truncated = _truncate_text(strip_local_image_refs(content), max_chars)
        return {
            "media_type": media_type,
            "content": content,
            "truncated": truncated,
            # 仅回传可供用户跳转的原文地址（不含鉴权 header，避免凭证外泄）
            "url": url if not headers else "",
            "note_id": "",
        }

    async def _download_bytes(self, url: str, headers: dict[str, Any] | None = None) -> bytes:
        """下载 media_url 指向的原文，返回原始字节。"""
        request_headers = {"User-Agent": "MedAI-Workbench/1.0"}
        for key, value in (headers or {}).items():
            if isinstance(key, str) and isinstance(value, str):
                request_headers[key] = value

        async with httpx.AsyncClient(timeout=IMA_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(url, headers=request_headers)
            response.raise_for_status()
            return response.content


_ima_client: ImaClient | None = None


def get_ima_client() -> ImaClient:
    """返回 IMA 客户端单例（凭证来自启动时 settings）。"""
    global _ima_client
    if _ima_client is None:
        _ima_client = ImaClient(
            settings.ima_openapi_clientid.get_secret_value(),
            settings.ima_openapi_apikey.get_secret_value(),
        )
    return _ima_client
