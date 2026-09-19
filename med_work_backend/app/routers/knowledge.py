"""知识库 API：文档管理、向量检索统一 HTTP 代理到 RAG 服务（服务 B）；IMA 外部集成保留在本服务。

鉴权策略：读（总览 / 列表 / 下载 / 检索 / IMA 浏览）登录即可；
写类操作按功能权限点拦截：upload / update（重建索引）/ delete（删除），
再由 rag_proxy 携带当前用户的 hospital_id 转发到服务 B；服务 B 不做鉴权。
"""
import logging
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.exceptions import AppError, ImaApiError, ImaNotConfigured, NotFoundError
from app.models import Document, RbacUser
from app.schemas.knowledge import (
    DocumentDetailOut,
    DocumentListResponse,
    DocumentOut,
    ImaImportResponse,
    ImaKnowledgeBaseListResponse,
    ImaKnowledgeContentResponse,
    ImaKnowledgeItem,
    ImaKnowledgePathNode,
    ImaMediaDetailResponse,
    ImaNoteSaveRequest,
    ImaNoteSaveResponse,
    ImaSearchResponse,
    KnowledgeOverview,
    SearchResponse,
    UploadResponse,
)
from app.services import rag_proxy
from app.clients.ima_client import get_ima_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _hospital_id(user: RbacUser) -> int:
    return user.hospital_id or 1


@router.get("/overview", response_model=KnowledgeOverview)
async def get_overview(
    user: RbacUser = Depends(get_current_user),
) -> KnowledgeOverview:
    """知识库总览统计（当前医院，代理 RAG 服务）。"""
    body = await rag_proxy.get_overview(hospital_id=_hospital_id(user))
    return KnowledgeOverview.model_validate(body)


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    keyword: str | None = None,
    doc_type: str | None = None,
    status: str | None = None,
    source_type: str | None = Query(None, description="来源分类：system 系统知识库 / ima IMA 集成"),
    page: int = 1,
    page_size: int = 10,
    user: RbacUser = Depends(get_current_user),
) -> DocumentListResponse:
    """文档列表（分页 + 筛选，代理 RAG 服务）。"""
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    body = await rag_proxy.list_documents(
        hospital_id=_hospital_id(user),
        keyword=keyword,
        doc_type=doc_type,
        status=status,
        source_type=source_type,
        page=page,
        page_size=page_size,
    )
    return DocumentListResponse.model_validate(body)


@router.post("/documents/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(..., description="文档文件（pdf/docx/txt/md）"),
    title: str | None = Form(None, description="文档标题，缺省取文件名"),
    doc_type: str = Form("guide", description="guide/literature/drug/case/norm/other"),
    sub_type: str | None = Form(None, description="子分类（专科/亚类，如心血管、内分泌）"),
    source: str | None = Form(None, description="文档来源"),
    source_type: str = Form("system", description="来源分类：system/ima"),
    remark: str | None = Form(None, description="备注"),
    user: RbacUser = Depends(require_permission("knowledge_document:upload")),
) -> UploadResponse:
    """上传文档并同步完成解析、向量化入库（需 knowledge_document:upload，文件实际由 RAG 服务落盘）。"""
    file_name = file.filename or "unnamed"
    content = await file.read()
    body = await rag_proxy.upload_document(
        hospital_id=_hospital_id(user),
        file_name=file_name,
        file_content=content,
        title=(title or "").strip() or None,
        doc_type=doc_type,
        sub_type=(sub_type or "").strip() or None,
        source=(source or "").strip() or None,
        source_type=source_type,
        remark=(remark or "").strip() or None,
    )
    return UploadResponse.model_validate(body)


@router.get("/documents/{doc_id}/download")
async def download_document(
    doc_id: int,
    user: RbacUser = Depends(get_current_user),
) -> Response:
    """下载文档原始文件（attachment 流，经 RAG 服务按租户转发；需登录）。"""
    content, media_type, filename = await rag_proxy.download_document(
        hospital_id=_hospital_id(user),
        doc_id=doc_id,
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/documents/{doc_id}", response_model=DocumentDetailOut)
async def get_document(
    doc_id: int,
    user: RbacUser = Depends(get_current_user),
) -> DocumentDetailOut:
    """文档详情：元信息 + 分块列表（代理 RAG 服务）。"""
    body = await rag_proxy.get_document(hospital_id=_hospital_id(user), doc_id=doc_id)
    return DocumentDetailOut.model_validate(body)


@router.delete("/documents/{doc_id}", response_model=dict)
async def delete_document(
    doc_id: int,
    user: RbacUser = Depends(require_permission("knowledge_document:delete")),
) -> dict:
    """删除文档（清向量/分块/文件，需 knowledge_document:delete，代理 RAG 服务）。"""
    await rag_proxy.delete_document(hospital_id=_hospital_id(user), doc_id=doc_id)
    return {"ok": True}


@router.post("/documents/{doc_id}/reindex", response_model=DocumentOut)
async def reindex_document(
    doc_id: int,
    user: RbacUser = Depends(require_permission("knowledge_document:update")),
) -> DocumentOut:
    """重新解析并索引文档（需 knowledge_document:update，代理 RAG 服务）。"""
    body = await rag_proxy.reindex_document(hospital_id=_hospital_id(user), doc_id=doc_id)
    return DocumentOut.model_validate(body)


@router.post("/documents/{doc_id}/index", response_model=DocumentOut)
async def start_document_index(
    doc_id: int,
    background_tasks: BackgroundTasks,
    user: RbacUser = Depends(require_permission("knowledge_document:update")),
    db: Session = Depends(get_db),
) -> DocumentOut:
    """为「未索引」的 IMA 文档启动索引（两步式导入的第二步）。

    立即把状态置为 parsing 并返回，随后在后台：
        IMA 取回正文 → RAG 服务切分 → bge 向量化 → 写 Qdrant
    前端靠轮询文档状态（parsing → ready/failed）跟进进度。需 knowledge_document:update。
    """
    hospital_id = _hospital_id(user)
    doc = db.get(Document, doc_id)
    if doc is None or doc.hospital_id != hospital_id or doc.deleted_at is not None:
        raise NotFoundError("文档不存在")
    if doc.status == "parsing":
        raise AppError("文档正在索引中，请稍候", code="MED_DOC_INDEXING")
    if not doc.source_media_id:
        raise AppError(
            "该文档无来源媒体 ID，无法从 IMA 取回内容；请使用「重新索引」",
            code="MED_DOC_NOT_IMA_SOURCE",
        )

    doc.status = "parsing"
    doc.error_message = None
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(
        _run_ima_index, hospital_id, doc_id, doc.source_media_id, doc.title
    )
    return DocumentOut.model_validate(doc)


@router.get("/search", response_model=SearchResponse)
async def search_knowledge(
    q: str,
    limit: int = 10,
    user: RbacUser = Depends(get_current_user),
) -> SearchResponse:
    """语义检索（基于 bge 向量 + Qdrant，代理 RAG 服务）。"""
    limit = min(max(1, limit), 50)
    body = await rag_proxy.search(hospital_id=_hospital_id(user), q=q, limit=limit)
    return SearchResponse.model_validate(body)


# ---------- IMA 外部集成（保留在本服务，不迁移到 RAG 服务）----------


def _ima_client_or_response():
    """返回 (client, configured)。未配置时返回 (None, False)，由调用方组装空响应。"""
    client = get_ima_client()
    return client, client.configured


@router.get("/ima/knowledge-bases", response_model=ImaKnowledgeBaseListResponse)
async def list_ima_knowledge_bases(
    query: str | None = Query(None, description="知识库名称关键字，空则全部"),
    limit: int = Query(20, ge=1, le=100),
    user: RbacUser = Depends(get_current_user),
) -> ImaKnowledgeBaseListResponse:
    """列出 IMA 远程知识库（未配置时返回 configured=False）。"""
    client, configured = _ima_client_or_response()
    if not configured:
        return ImaKnowledgeBaseListResponse(configured=False, items=[])
    try:
        raw = await client.list_knowledge_bases(query=query or "", limit=limit)
    except (ImaNotConfigured, ImaApiError) as exc:
        return ImaKnowledgeBaseListResponse(configured=True, items=[], error=str(exc))
    items = [
        {
            "id": str(item.get("id") or ""),
            "name": str(item.get("name") or ""),
            "base_type": item.get("base_type"),
            "role_type": item.get("role_type"),
            "member_count": int(item.get("member_count") or 0),
            "content_count": int(item.get("content_count") or 0),
        }
        for item in raw
        if item.get("id")
    ]
    return ImaKnowledgeBaseListResponse(configured=True, items=items)


@router.get("/ima/search", response_model=ImaSearchResponse)
async def search_ima_knowledge(
    q: str = Query(..., description="检索关键词"),
    kb_name: str | None = Query(None, description="限定知识库名称"),
    limit: int = Query(5, ge=1, le=20),
    user: RbacUser = Depends(get_current_user),
) -> ImaSearchResponse:
    """检索 IMA 知识库内容（未配置时返回 configured=False）。"""
    client, configured = _ima_client_or_response()
    if not configured:
        return ImaSearchResponse(configured=False, query=q, hits=[])
    try:
        raw = await client.search_knowledge(query=q, kb_name=kb_name, limit=limit)
    except (ImaNotConfigured, ImaApiError) as exc:
        return ImaSearchResponse(configured=True, query=q, hits=[], error=str(exc))
    hits = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        hits.append(
            {
                "knowledge_base": str(item.get("knowledge_base") or ""),
                "title": str(item.get("title") or ""),
                "snippet": str(item.get("snippet") or ""),
                "media_id": item.get("media_id") or None,
                "url": item.get("url") or None,
            }
        )
    return ImaSearchResponse(
        configured=True, query=q, hits=hits, total=len(hits), error=None
    )


@router.get("/ima/knowledge-bases/{kb_id}/contents", response_model=ImaKnowledgeContentResponse)
async def list_ima_knowledge_contents(
    kb_id: str,
    folder_id: str | None = Query(None, description="文件夹 ID（带 folder_ 前缀），空表示知识库根目录"),
    user: RbacUser = Depends(get_current_user),
) -> ImaKnowledgeContentResponse:
    """浏览 IMA 知识库目录：返回当前文件夹下的文件夹与文档条目（未配置时返回 configured=False）。"""
    client, configured = _ima_client_or_response()
    if not configured:
        return ImaKnowledgeContentResponse(configured=False, kb_id=kb_id)
    try:
        raw = await client.list_knowledge_contents(kb_id, folder_id)
    except (ImaNotConfigured, ImaApiError) as exc:
        return ImaKnowledgeContentResponse(
            configured=True, kb_id=kb_id, folder_id=folder_id, error=str(exc)
        )
    return ImaKnowledgeContentResponse(
        configured=True,
        kb_id=kb_id,
        folder_id=folder_id,
        current_path=[ImaKnowledgePathNode(**node) for node in raw.get("current_path") or []],
        items=[ImaKnowledgeItem(**item) for item in raw.get("items") or []],
    )


@router.get("/ima/media/{media_id}", response_model=ImaMediaDetailResponse)
async def get_ima_media_detail(
    media_id: str,
    user: RbacUser = Depends(get_current_user),
) -> ImaMediaDetailResponse:
    """查看 IMA 文件详情：取回原文/笔记正文（清洗为纯文本后返回）。"""
    client, configured = _ima_client_or_response()
    if not configured:
        return ImaMediaDetailResponse(configured=False, media_id=media_id)
    try:
        raw = await client.get_media_detail(media_id)
    except (ImaNotConfigured, ImaApiError) as exc:
        return ImaMediaDetailResponse(configured=True, media_id=media_id, error=str(exc))
    return ImaMediaDetailResponse(
        configured=True,
        media_id=media_id,
        media_type=raw.get("media_type"),
        content=raw.get("content") or "",
        truncated=bool(raw.get("truncated")),
        url=raw.get("url") or "",
        note_id=raw.get("note_id") or "",
    )


def _mark_document_failed(doc_id: int, reason: str) -> None:
    """把文档置为 failed（独立会话，供后台任务在失败时调用）。"""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        doc = db.get(Document, doc_id)
        if doc is not None:
            doc.status = "failed"
            doc.error_message = reason[:500]
            db.commit()
    except Exception:  # noqa: BLE001 - 兜底，不向上抛
        logger.exception("置文档 failed 失败 doc_id=%s", doc_id)
        db.rollback()
    finally:
        db.close()


async def _run_ima_index(
    hospital_id: int, doc_id: int, media_id: str, title: str
) -> None:
    """后台任务：向 IMA 取回正文，再交给 RAG 服务切分 + 向量化。

    主路径按 media_id 取全文；取不到时回退为按标题检索取片段。
    均失败则把文档置为 failed 并写明原因。
    """
    from app.clients.ima_client import get_ima_client

    client = get_ima_client()
    content = ""
    try:
        detail = await client.get_media_detail(media_id)
        content = (detail.get("content") or "").strip()
    except Exception:  # noqa: BLE001 - 主路径失败则尝试回退
        logger.warning("按 media_id 取 IMA 正文失败 doc_id=%s: %s", doc_id, media_id)

    if not content and title:
        # 回退：按标题走 IMA 语义检索取片段（内容不完整，仅作兜底）
        try:
            hits = await client.search_knowledge(query=title, limit=3)
            parts = [f"{h.get('title') or ''}\n{h.get('snippet') or ''}" for h in hits or []]
            content = "\n\n".join(p for p in parts if p.strip()).strip()
            if content:
                logger.info("IMA 正文回退为检索片段 doc_id=%s", doc_id)
        except Exception:  # noqa: BLE001
            logger.warning("按标题检索回退失败 doc_id=%s", doc_id)

    try:
        await rag_proxy.index_document_text(
            hospital_id=hospital_id,
            doc_id=doc_id,
            content=content,
            file_ext=".md",
        )
    except Exception as exc:  # noqa: BLE001 - 后台任务失败需把状态落回 failed
        logger.exception("IMA 文档索引失败 doc_id=%s media_id=%s", doc_id, media_id)
        _mark_document_failed(doc_id, f"索引失败：{exc}")


@router.post("/ima/media/{media_id}/import", response_model=ImaImportResponse)
async def import_ima_media(
    background_tasks: BackgroundTasks,
    media_id: str,
    title: str | None = Form(None, description="文档标题（缺省取 IMA 条目名）"),
    doc_type: str = Form("guide", description="guide/literature/drug/case/norm/other"),
    user: RbacUser = Depends(require_permission("knowledge_document:upload")),
) -> ImaImportResponse:
    """把 IMA 远程文档登记到本地知识库（两步式导入的第一步）。

    只建立元信息记录（status=uploaded），**不下载正文、不切分、不向量化**，
    因此秒级返回。随后在「上传任务」中对该条点击「开始索引」，才会：
        IMA 取回正文 → 切分 → bge 向量化 → Qdrant
    需 knowledge_document:upload。
    """
    client, configured = _ima_client_or_response()
    if not configured:
        return ImaImportResponse(configured=False, media_id=media_id, title=title or "")

    try:
        raw = await rag_proxy.create_ima_placeholder(
            hospital_id=_hospital_id(user),
            media_id=media_id,
            title=(title or "").strip(),
            file_ext=".md",
            doc_type=doc_type,
            remark="来源：IMA 知识库",
        )
    except Exception as exc:  # noqa: BLE001 - 统一收敛为业务错误文案
        logger.warning("创建 IMA 占位记录失败 media_id=%s: %s", media_id, exc)
        return ImaImportResponse(
            configured=True, media_id=media_id, title=title or "", error=str(exc)
        )

    doc = (raw or {}).get("document") or {}
    return ImaImportResponse(
        configured=True,
        media_id=media_id,
        title=doc.get("title") or title or "",
        submitted=True,
    )


@router.post("/ima/notes", response_model=ImaNoteSaveResponse)
async def save_ima_note(
    payload: ImaNoteSaveRequest,
    user: RbacUser = Depends(get_current_user),
) -> ImaNoteSaveResponse:
    """把内容保存为 IMA 笔记（未配置时返回 configured=False）。

    注意：IMA 为外部云端服务，保存即医疗数据出网，需确认合规。
    """
    client, configured = _ima_client_or_response()
    if not configured:
        return ImaNoteSaveResponse(configured=False)
    try:
        note_id = await client.save_note(title=payload.title, content=payload.content)
    except (ImaNotConfigured, ImaApiError) as exc:
        return ImaNoteSaveResponse(configured=True, error=str(exc))
    return ImaNoteSaveResponse(configured=True, note_id=note_id)
