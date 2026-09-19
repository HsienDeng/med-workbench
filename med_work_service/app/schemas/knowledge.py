"""知识库相关请求 / 响应模型（仅保留 RAG 内部接口所需，字段与服务 A 对齐）。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DocumentOut(BaseModel):
    """文档列表 / 详情项。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    file_name: str
    file_ext: str
    file_size: int
    doc_type: str
    sub_type: str | None = None
    summary: str | None = None
    source: str
    source_type: str = "system"
    source_media_id: str | None = None
    remark: str | None = None
    status: str
    chunk_count: int
    vector_count: int
    error_message: str | None = None
    created_by: str
    created_at: datetime
    updated_at: datetime


class DocumentChunkOut(BaseModel):
    """文档分块（详情展示）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    chunk_index: int
    title: str | None = None
    content: str
    char_count: int


class DocumentDetailOut(BaseModel):
    """文档详情：元信息 + 分块列表。"""

    document: DocumentOut
    chunks: list[DocumentChunkOut] = []


class DocumentListResponse(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    page_size: int


class UploadResponse(BaseModel):
    document: DocumentOut
    message: str = "上传成功"


class ImaPlaceholderRequest(BaseModel):
    """IMA 两步式导入第一步：建立占位记录（不下载内容）。"""

    hospital_id: int
    media_id: str = Field(..., min_length=1)
    title: str = ""
    file_ext: str = ".md"
    doc_type: str = "other"
    remark: str | None = None


class IndexTextRequest(BaseModel):
    """IMA 两步式导入第二步：用外部取回的正文建立索引。"""

    content: str = ""
    file_ext: str | None = None


class DistributionItem(BaseModel):
    doc_type: str
    label: str
    count: int


class StatusItem(BaseModel):
    status: str
    label: str
    count: int


class KnowledgeOverview(BaseModel):
    total_documents: int
    ready_documents: int
    parsing_documents: int
    failed_documents: int
    total_chunks: int
    total_vectors: int
    total_size_bytes: int
    doc_type_distribution: list[DistributionItem] = []
    status_distribution: list[StatusItem] = []
    recent_documents: list[DocumentOut] = []
    embedding_model: str = ""
    embedding_ready: bool = False
    vector_db_connected: bool = False
    upload_dir: str = ""


class SearchHit(BaseModel):
    document_id: int
    title: str
    file_name: str = ""
    doc_type: str = "other"
    content: str
    score: float


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit] = []
    total: int = 0
