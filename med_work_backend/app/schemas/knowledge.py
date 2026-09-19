"""知识库相关请求 / 响应模型。"""
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


# ---------- IMA 外部集成 ----------

class ImaKnowledgeBaseItem(BaseModel):
    """IMA 远程知识库条目。"""

    id: str
    name: str = ""
    base_type: str | None = None
    role_type: str | None = None
    member_count: int = 0
    content_count: int = 0


class ImaKnowledgeBaseListResponse(BaseModel):
    """IMA 知识库列表（configured=False 表示未配置，前端展示引导）。"""

    configured: bool
    items: list[ImaKnowledgeBaseItem] = []
    error: str | None = None


class ImaSearchHit(BaseModel):
    """IMA 检索命中条目。"""

    knowledge_base: str = ""
    title: str = ""
    snippet: str = ""
    media_id: str | None = None
    url: str | None = None


class ImaSearchResponse(BaseModel):
    """IMA 检索结果（configured=False 表示未配置）。"""

    configured: bool
    query: str
    hits: list[ImaSearchHit] = []
    total: int = 0
    error: str | None = None


class ImaKnowledgeItem(BaseModel):
    """IMA 知识库目录条目（文件夹或文档）。"""

    media_id: str
    title: str = ""
    media_type: int = 0
    is_folder: bool = False
    parent_folder_id: str | None = None
    file_number: int = 0
    folder_number: int = 0


class ImaKnowledgePathNode(BaseModel):
    """IMA 知识库目录面包屑节点（顶层为知识库根，media_id=None）。"""

    folder_id: str
    media_id: str | None = None
    name: str = ""


class ImaKnowledgeContentResponse(BaseModel):
    """IMA 知识库目录浏览结果（configured=False 表示未配置）。"""

    configured: bool
    kb_id: str = ""
    folder_id: str | None = None
    current_path: list[ImaKnowledgePathNode] = []
    items: list[ImaKnowledgeItem] = []
    error: str | None = None


class ImaNoteSaveRequest(BaseModel):
    """保存 IMA 笔记请求。"""

    title: str = Field(..., min_length=1, max_length=200, description="笔记标题")
    content: str = Field(..., min_length=1, description="笔记正文（Markdown）")


class ImaNoteSaveResponse(BaseModel):
    """保存 IMA 笔记结果（configured=False 表示未配置）。"""

    configured: bool
    note_id: str | None = None
    error: str | None = None


class ImaMediaDetailResponse(BaseModel):
    """IMA 媒体（文件）详情，正文为清洗后的纯文本。"""

    configured: bool
    media_id: str = ""
    media_type: int | None = None
    content: str = ""
    truncated: bool = False
    url: str = ""
    note_id: str = ""
    error: str | None = None


class ImaImportResponse(BaseModel):
    """IMA 文档搬运（同步到本地知识库）提交结果。

    submitted=True 表示已进入后台处理，处理结果通过本地文档列表
    （source_type=ima）观察，parsing → ready/failed。
    """

    configured: bool
    media_id: str = ""
    title: str = ""
    submitted: bool = False
    error: str | None = None
