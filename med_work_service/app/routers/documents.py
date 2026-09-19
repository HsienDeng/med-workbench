"""RAG 服务内部 API：仅对内网开放，由服务 A 完成鉴权后代理调用。

安全约定：
- 本服务不做登录鉴权，所有接口必须携带 hospital_id 租户参数
  （上传走 multipart form 的 hospital_id 字段，其余走 query 参数）；
- 服务应只监听 127.0.0.1 或内网网卡，勿直接暴露公网。
"""

import logging
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.database import get_db
from app.exceptions import AppError
from app.models import Document
from app.schemas.knowledge import (
    DocumentDetailOut,
    DocumentListResponse,
    DocumentOut,
    ImaPlaceholderRequest,
    IndexTextRequest,
    KnowledgeOverview,
    SearchResponse,
    UploadResponse,
)
from app.services import document_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["rag-internal"])


def _require_hospital_id(hospital_id: int) -> int:
    """租户参数强校验：缺失/非法一律拒绝，杜绝越权访问其他医院数据。"""
    if not hospital_id or hospital_id <= 0:
        raise AppError("缺少合法的 hospital_id 租户参数", code="MED_MISSING_TENANT")
    return hospital_id


@router.post("/documents/upload", response_model=UploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    hospital_id: int = Form(...),
    file: UploadFile = File(...),
    title: str | None = Form(None),
    doc_type: str = Form("guide"),
    sub_type: str | None = Form(None),
    source: str | None = Form(None),
    source_type: str = Form("system"),
    remark: str | None = Form(None),
    db: Session = Depends(get_db),
) -> UploadResponse:
    """上传文档：立即落盘建记录（parsing），解析/切分/向量化由后台线程异步完成。

    前端通过轮询文档状态（parsing → ready/failed）感知进度。
    """
    _require_hospital_id(hospital_id)
    file_content = await file.read()
    doc = document_service.create_document(
        db,
        hospital_id=hospital_id,
        file_name=file.filename or "unnamed",
        file_content=file_content,
        title=title or "",
        doc_type=doc_type,
        sub_type=sub_type,
        source=source or "",
        source_type=source_type,
        remark=remark,
        created_by=f"hospital-{hospital_id}",
    )
    background_tasks.add_task(
        run_in_threadpool,
        document_service.run_document_indexing,
        doc.id,
        hospital_id,
    )
    return UploadResponse(
        document=DocumentOut.model_validate(doc),
        message="上传成功，正在后台解析与向量化",
    )


@router.post("/documents/ima-placeholder", response_model=UploadResponse)
def create_ima_placeholder(
    payload: ImaPlaceholderRequest,
    db: Session = Depends(get_db),
) -> UploadResponse:
    """IMA 两步式导入第一步：只建记录（status=uploaded），不下载内容、不索引。

    第二步由 A 取回正文后调用 /internal/documents/{id}/index-text 完成。
    """
    _require_hospital_id(payload.hospital_id)
    doc = document_service.create_ima_placeholder(
        db,
        hospital_id=payload.hospital_id,
        media_id=payload.media_id,
        title=payload.title,
        file_ext=payload.file_ext,
        doc_type=payload.doc_type,
        remark=payload.remark,
        created_by=f"hospital-{payload.hospital_id}",
    )
    already = doc.status != "uploaded"
    return UploadResponse(
        document=DocumentOut.model_validate(doc),
        message=("该 IMA 文件已在列表中" if already else "已加入上传任务，点击「开始索引」后处理"),
    )


@router.post("/documents/{doc_id}/index-text", response_model=UploadResponse)
async def index_document_text(
    doc_id: int,
    payload: IndexTextRequest,
    background_tasks: BackgroundTasks,
    hospital_id: int = Query(...),
    db: Session = Depends(get_db),
) -> UploadResponse:
    """IMA 两步式导入第二步：用外部取回的正文建立索引。

    立即置 parsing 并返回，实际切分 / 向量化在后台线程执行，前端靠轮询跟进。
    """
    _require_hospital_id(hospital_id)
    doc = document_service.get_document_or_404(db, hospital_id, doc_id)
    # 不拒绝 parsing：服务 A 触发时已置该状态，防重在其侧完成
    doc.status = "parsing"
    doc.error_message = None
    db.commit()
    db.refresh(doc)

    background_tasks.add_task(
        _run_index_text,
        doc_id,
        hospital_id,
        payload.content,
        payload.file_ext,
    )
    return UploadResponse(
        document=DocumentOut.model_validate(doc),
        message="已开始索引，请稍候查看进度",
    )


def _run_index_text(
    doc_id: int, hospital_id: int, content: str, file_ext: str | None
) -> None:
    """后台执行文本索引（独立会话，异常统一置 failed）。"""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        doc = db.scalar(
            select(Document).where(
                Document.id == doc_id,
                Document.hospital_id == hospital_id,
                Document.deleted_at.is_(None),
            )
        )
        if doc is None:
            return
        document_service.index_document_text(db, doc, content, file_ext=file_ext)
    except Exception as exc:  # noqa: BLE001 - 兜底：后台任务不向外抛
        logger.exception("后台文本索引失败 doc_id=%s", doc_id)
        try:
            doc = db.get(Document, doc_id)
            if doc is not None:
                doc.status = "failed"
                doc.error_message = f"索引失败：{exc}"[:500]
                db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
    finally:
        db.close()


@router.get("/documents", response_model=DocumentListResponse)
def list_documents(
    hospital_id: int = Query(...),
    keyword: str | None = Query(None),
    doc_type: str | None = Query(None),
    status: str | None = Query(None),
    source_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
) -> DocumentListResponse:
    _require_hospital_id(hospital_id)
    items, total = document_service.list_documents(
        db,
        hospital_id=hospital_id,
        keyword=keyword,
        doc_type=doc_type,
        status=status,
        source_type=source_type,
        page=page,
        page_size=page_size,
    )
    return DocumentListResponse(
        items=[DocumentOut.model_validate(d) for d in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/documents/overview", response_model=KnowledgeOverview)
def get_overview(
    hospital_id: int = Query(...),
    db: Session = Depends(get_db),
) -> KnowledgeOverview:
    _require_hospital_id(hospital_id)
    return KnowledgeOverview.model_validate(
        document_service.get_overview(db, hospital_id=hospital_id)
    )


@router.get("/documents/{doc_id}", response_model=DocumentDetailOut)
def get_document(
    doc_id: int,
    hospital_id: int = Query(...),
    db: Session = Depends(get_db),
) -> DocumentDetailOut:
    _require_hospital_id(hospital_id)
    doc = document_service.get_document_or_404(db, hospital_id, doc_id)
    detail = document_service.get_document_detail(db, doc)
    return DocumentDetailOut(
        document=DocumentOut.model_validate(detail["document"]),
        chunks=detail["chunks"],
    )


@router.get("/documents/{doc_id}/download")
def download_document(
    doc_id: int,
    hospital_id: int = Query(...),
    db: Session = Depends(get_db),
) -> FileResponse:
    """下载文档原始文件（attachment 流式返回；按租户鉴权后由服务 A 代理调用）。

    IMA 占位记录（file_path=ima://...）或磁盘文件已丢失时返回业务错误。
    """
    _require_hospital_id(hospital_id)
    doc = document_service.get_document_or_404(db, hospital_id, doc_id)
    abs_path = document_service.get_download_file_path(doc)
    if abs_path is None:
        raise AppError(
            "该文档没有可下载的原始文件（IMA 导入或文件已丢失）",
            code="MED_DOC_FILE_MISSING",
        )
    return FileResponse(
        abs_path,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(doc.file_name)}"},
    )


@router.delete("/documents/{doc_id}", response_model=dict)
def delete_document(
    doc_id: int,
    hospital_id: int = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    _require_hospital_id(hospital_id)
    doc = document_service.get_document_or_404(db, hospital_id, doc_id)
    document_service.delete_document(db, doc)
    return {"message": "删除成功", "document_id": doc_id}


@router.post("/documents/{doc_id}/reindex", response_model=DocumentOut)
def reindex_document(
    doc_id: int,
    hospital_id: int = Query(...),
    db: Session = Depends(get_db),
) -> DocumentOut:
    _require_hospital_id(hospital_id)
    doc = document_service.get_document_or_404(db, hospital_id, doc_id)
    doc = document_service.reindex_document(db, doc)
    return DocumentOut.model_validate(doc)


@router.get("/search", response_model=SearchResponse)
def search(
    hospital_id: int = Query(...),
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=30),
    db: Session = Depends(get_db),
) -> SearchResponse:
    _require_hospital_id(hospital_id)
    return SearchResponse.model_validate(
        document_service.search_knowledge(db, hospital_id=hospital_id, query=q, limit=limit)
    )
