"""RAG 服务（服务 B，med_rag_service）HTTP 代理客户端。

服务 A 不再持有任何 RAG 本地代码（文档解析/切分/embedding/Qdrant），
知识库全部接口统一经本层转发到服务 B，鉴权仍由服务 A 完成，
hospital_id 租户参数由本层从调用方传入并透传给服务 B。
"""

import logging
import re
import urllib.parse
from typing import Any

import httpx

from app.config import settings
from app.exceptions import AppError, RagServiceUnavailable

logger = logging.getLogger(__name__)

_BASE_URL = settings.rag_service_base_url.rstrip("/")


def _raise_for_response(resp: httpx.Response) -> None:
    """非 2xx 时尽量透传服务 B 的业务错误码与文案。"""
    if resp.is_success:
        return
    try:
        body = resp.json()
        code = body.get("code") or "MED_RAG_ERROR"
        message = body.get("message") or f"RAG 服务返回 {resp.status_code}"
    except Exception:  # noqa: BLE001
        code, message = "MED_RAG_ERROR", f"RAG 服务返回 {resp.status_code}"
    raise AppError(str(message), code=code)


def _wrap_transport_error(exc: Exception) -> AppError:
    """网络层失败统一收敛为 RagServiceUnavailable。"""
    logger.warning("RAG 服务调用失败：%s", exc)
    if isinstance(exc, httpx.TimeoutException):
        return AppError("知识库服务处理超时，请稍后重试", code="MED_RAG_UNAVAILABLE")
    return RagServiceUnavailable()


async def _request(method: str, path: str, **kwargs: Any) -> dict:
    """发起 HTTP 请求并解析 JSON，统一错误处理。"""
    try:
        async with httpx.AsyncClient(timeout=settings.rag_service_timeout) as client:
            resp = await client.request(method, f"{_BASE_URL}{path}", **kwargs)
    except httpx.HTTPError as exc:
        raise _wrap_transport_error(exc) from exc
    _raise_for_response(resp)
    return resp.json()


async def health() -> dict:
    """RAG 服务健康状态（不可达时抛 RagServiceUnavailable）。"""
    return await _request("GET", "/health")


# ---------- 文档管理 ----------

async def upload_document(
    *,
    hospital_id: int,
    file_name: str,
    file_content: bytes,
    title: str | None,
    doc_type: str,
    sub_type: str | None,
    source: str | None,
    source_type: str,
    remark: str | None,
) -> dict:
    """上传文档并同步完成解析、切分、向量化入库（multipart 转发）。"""
    data = {
        "hospital_id": str(hospital_id),
        "doc_type": doc_type,
        "source_type": source_type,
    }
    if title:
        data["title"] = title
    if sub_type:
        data["sub_type"] = sub_type
    if source:
        data["source"] = source
    if remark:
        data["remark"] = remark
    files = {
        "file": (
            file_name,
            file_content,
            "application/octet-stream",
        )
    }
    return await _request("POST", "/internal/documents/upload", data=data, files=files)


async def list_documents(
    *,
    hospital_id: int,
    keyword: str | None = None,
    doc_type: str | None = None,
    status: str | None = None,
    source_type: str | None = None,
    page: int = 1,
    page_size: int = 10,
) -> dict:
    params: dict[str, Any] = {
        "hospital_id": hospital_id,
        "page": page,
        "page_size": page_size,
    }
    for key, value in (
        ("keyword", keyword),
        ("doc_type", doc_type),
        ("status", status),
        ("source_type", source_type),
    ):
        if value:
            params[key] = value
    return await _request("GET", "/internal/documents", params=params)


async def get_overview(*, hospital_id: int) -> dict:
    return await _request("GET", "/internal/documents/overview", params={"hospital_id": hospital_id})


async def get_document(*, hospital_id: int, doc_id: int) -> dict:
    return await _request("GET", f"/internal/documents/{doc_id}", params={"hospital_id": hospital_id})


async def delete_document(*, hospital_id: int, doc_id: int) -> dict:
    return await _request("DELETE", f"/internal/documents/{doc_id}", params={"hospital_id": hospital_id})


async def reindex_document(*, hospital_id: int, doc_id: int) -> dict:
    return await _request("POST", f"/internal/documents/{doc_id}/reindex", params={"hospital_id": hospital_id})


async def create_ima_placeholder(
    *,
    hospital_id: int,
    media_id: str,
    title: str = "",
    file_ext: str = ".md",
    doc_type: str = "other",
    remark: str | None = None,
) -> dict:
    """IMA 两步式导入第一步：仅建占位记录，不下载内容。"""
    payload: dict[str, Any] = {
        "hospital_id": hospital_id,
        "media_id": media_id,
        "title": title,
        "file_ext": file_ext,
        "doc_type": doc_type,
    }
    if remark:
        payload["remark"] = remark
    return await _request("POST", "/internal/documents/ima-placeholder", json=payload)


async def index_document_text(
    *, hospital_id: int, doc_id: int, content: str, file_ext: str | None = None
) -> dict:
    """IMA 两步式导入第二步：用已取回的正文建立索引（内部异步执行）。"""
    payload: dict[str, Any] = {"content": content}
    if file_ext:
        payload["file_ext"] = file_ext
    return await _request(
        "POST",
        f"/internal/documents/{doc_id}/index-text",
        params={"hospital_id": hospital_id},
        json=payload,
    )


async def search(*, hospital_id: int, q: str, limit: int = 10) -> dict:
    return await _request(
        "GET", "/internal/search", params={"hospital_id": hospital_id, "q": q, "limit": limit}
    )


def _parse_filename(disposition: str) -> str:
    """从 Content-Disposition 解析文件名（优先 RFC5987 filename*）。"""
    if not disposition:
        return ""
    star = re.search(r"filename\*\s*=\s*UTF-8''([^;]+)", disposition, re.IGNORECASE)
    if star:
        return urllib.parse.unquote(star.group(1).strip().strip('"'))
    plain = re.search(r"filename\s*=\s*\"?([^\";]+)\"?", disposition, re.IGNORECASE)
    if plain:
        return plain.group(1).strip()
    return ""


async def download_document(*, hospital_id: int, doc_id: int) -> tuple[bytes, str, str]:
    """下载文档原始文件，返回 (content, content_type, filename)。

    文件名从响应头 Content-Disposition 解析，失败时降级为通用占位名。
    """
    try:
        async with httpx.AsyncClient(timeout=settings.rag_service_timeout) as client:
            resp = await client.get(
                f"{_BASE_URL}/internal/documents/{doc_id}/download",
                params={"hospital_id": hospital_id},
            )
    except httpx.HTTPError as exc:
        raise _wrap_transport_error(exc) from exc
    _raise_for_response(resp)
    content_type = resp.headers.get("content-type") or "application/octet-stream"
    filename = _parse_filename(resp.headers.get("content-disposition") or "")
    return resp.content, content_type, filename or f"document_{doc_id}.bin"
