"""业务服务层包：Router 层不直接操作数据库，统一经由本层；外部客户端见 app.clients。

注意：知识库文档管理/向量检索已拆分为独立 RAG 服务（med_rag_service），
本层通过 rag_proxy 以 HTTP 方式转发，不直接持有 RAG 相关本地代码。
"""

from app.services import auth_service, rag_proxy, seed

__all__ = [
    "auth_service",
    "rag_proxy",
    "seed",
]
