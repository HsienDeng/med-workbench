"""数据模型包：仅知识库相关 ORM（与服务 A 共用 med_documents / med_document_chunks 表）。"""
from app.models.knowledge import Document, DocumentChunk

__all__ = ["Document", "DocumentChunk"]
