"""知识库 ORM 模型：文档 + 文本分块。

向量本身存储在 Qdrant（本地模式落盘），此处仅保存文档元信息与分块文本，
便于文档管理、删除清理与检索结果回显。
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Document(Base):
    """上传的知识库文档。"""

    __tablename__ = "med_documents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, comment="所属医院ID")
    title: Mapped[str] = mapped_column(String(255), nullable=False, comment="文档标题")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False, comment="原始文件名")
    file_ext: Mapped[str] = mapped_column(String(16), nullable=False, comment="扩展名，如 .pdf")
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, comment="文件大小（字节）")
    file_path: Mapped[str] = mapped_column(String(512), nullable=False, comment="文件存储相对路径")
    doc_type: Mapped[str] = mapped_column(String(32), nullable=False, default="guide", comment="guide/literature/drug/case/norm/other")
    sub_type: Mapped[str | None] = mapped_column(String(64), comment="子分类（专科/亚类，如心血管、内分泌）")
    summary: Mapped[str | None] = mapped_column(Text, comment="LLM 生成的文档摘要")
    source: Mapped[str] = mapped_column(String(128), nullable=False, default="内部上传", comment="文档来源")
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="system", comment="来源分类：system 系统知识库 / ima 外部 IMA 集成")
    source_media_id: Mapped[str | None] = mapped_column(
        String(128), comment="来源媒体 ID（IMA 的 media_id，用于两步导入时二次取回内容）"
    )
    remark: Mapped[str | None] = mapped_column(String(500), comment="备注")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="parsing", comment="uploaded/parsing/ready/failed")
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="分块数")
    vector_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="已写入向量库的分块数")
    error_message: Mapped[str | None] = mapped_column(String(500), comment="解析/向量化失败原因")
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system", comment="上传人")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, comment="软删除时间")

    __table_args__ = (
        Index("ix_documents_hospital_status", "hospital_id", "status"),
        Index("ix_documents_hospital_deleted", "hospital_id", "deleted_at"),
    )


class DocumentChunk(Base):
    """文档分块文本（向量在 Qdrant，此处记录文本与对应点 ID）。"""

    __tablename__ = "med_document_chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hospital_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, comment="所属医院ID")
    document_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("med_documents.id", ondelete="CASCADE"), nullable=False, comment="文档ID"
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="分块序号（从0开始）")
    title: Mapped[str | None] = mapped_column(String(255), comment="分块标题（章节名，LLM 切分时生成）")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="分块文本")
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="字符数")
    point_id: Mapped[str | None] = mapped_column(String(96), comment="Qdrant 中的点 ID")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_doc_chunks_document", "document_id"),
        Index("ix_doc_chunks_hospital", "hospital_id"),
    )
