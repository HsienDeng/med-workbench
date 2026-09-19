"""Qdrant 本地模式封装。

使用 qdrant-client 的 local 模式：不依赖单独部署的 Qdrant 服务，
向量数据直接落盘到 settings.qdrant_path 目录，随项目走，方便部署。
"""

import logging
import os
import threading
from typing import Any

from app.config import settings
from app.services.embedding_service import EMBEDDING_DIM

logger = logging.getLogger(__name__)

COLLECTION_NAME = "medical_knowledge"

_client = None
_client_lock = threading.Lock()


class VectorDbError(RuntimeError):
    """向量库不可用。"""


def get_client():
    """懒加载 Qdrant 本地客户端。"""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.http import models as qmodels
        except ImportError as exc:  # pragma: no cover
            raise VectorDbError(
                "未安装 qdrant-client，请先执行 pip install -r requirements.txt"
            ) from exc

        path = os.path.abspath(settings.qdrant_path)
        os.makedirs(path, exist_ok=True)
        logger.info("初始化 Qdrant 本地客户端：%s", path)
        try:
            client = QdrantClient(path=path)
        except Exception as exc:
            raise VectorDbError(f"Qdrant 本地客户端初始化失败：{exc}") from exc

        # 幂等创建集合
        try:
            collections = client.get_collections().collections
            if not any(c.name == COLLECTION_NAME for c in collections):
                client.create_collection(
                    collection_name=COLLECTION_NAME,
                    vectors_config=qmodels.VectorParams(
                        size=EMBEDDING_DIM,
                        distance=qmodels.Distance.COSINE,
                    ),
                )
                logger.info("已创建 Qdrant 集合 %s (dim=%s)", COLLECTION_NAME, EMBEDDING_DIM)
        except Exception as exc:
            raise VectorDbError(f"Qdrant 集合初始化失败：{exc}") from exc

        _client = client
        return _client


def vector_db_ready() -> bool:
    """客户端是否已初始化（不触发初始化）。"""
    return _client is not None


def upsert_chunks(
    hospital_id: int,
    document_id: int,
    chunks: list[dict[str, Any]],
) -> int:
    """写入一批分块向量。

    chunks: [{point_id, content, vector}]，point_id 全局唯一。
    返回写入条数。
    """
    if not chunks:
        return 0
    client = get_client()
    from qdrant_client.http import models as qmodels

    points = [
        qmodels.PointStruct(
            id=c["point_id"],
            vector=c["vector"],
            payload={
                "hospital_id": hospital_id,
                "document_id": document_id,
                "content": c["content"],
            },
        )
        for c in chunks
    ]
    client.upsert(collection_name=COLLECTION_NAME, points=points)
    return len(points)


def delete_document_points(hospital_id: int, document_id: int) -> None:
    """删除某文档的所有向量点。"""
    if _client is None:
        return
    client = get_client()
    from qdrant_client.http import models as qmodels

    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=qmodels.FilterSelector(
            filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="hospital_id", match=qmodels.MatchValue(value=hospital_id)
                    ),
                    qmodels.FieldCondition(
                        key="document_id", match=qmodels.MatchValue(value=document_id)
                    ),
                ]
            )
        ),
    )


def search(
    hospital_id: int,
    query_vector: list[float],
    limit: int = 10,
) -> list[dict[str, Any]]:
    """向量检索，返回 [{document_id, content, score, ...}]。"""
    client = get_client()
    from qdrant_client.http import models as qmodels

    result = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=limit,
        query_filter=qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="hospital_id", match=qmodels.MatchValue(value=hospital_id)
                )
            ]
        ),
        with_payload=True,
    )
    return [
        {
            "document_id": point.payload.get("document_id"),
            "content": point.payload.get("content", ""),
            "score": round(float(point.score), 4),
        }
        for point in result.points
    ]


def count_vectors() -> int:
    """集合内向量总数（未初始化返回 0）。"""
    if _client is None:
        return 0
    try:
        info = get_client().get_collection(COLLECTION_NAME)
        return int(info.points_count or 0)
    except Exception:  # pragma: no cover
        return 0
