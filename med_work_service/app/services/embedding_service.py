"""本地文本向量化服务（bge-base-zh-v1.5）。

模型懒加载：首次调用时才真正下载/载入，避免拖慢服务启动。
- embedding_model_name 可配置为 HuggingFace 模型名或本地模型目录绝对路径。
- 国内网络默认走 hf-mirror.com（若已设置 HF_ENDPOINT 则尊重用户配置）。
- 模型加载失败会抛 EmbeddingError，调用方应降级处理（文档标记 failed）。
"""

import logging
import os
import threading

from app.config import settings

logger = logging.getLogger(__name__)

# 国内网络默认使用 HF 镜像，若用户已显式配置则优先用户的
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

# bge-base-zh-v1.5 的向量维度（768）。若换成其他模型需同步修改。
EMBEDDING_DIM = 768


class EmbeddingError(RuntimeError):
    """向量化不可用（模型未加载/加载失败）。"""


_model = None
_model_lock = threading.Lock()


def _load_model():
    """加载 SentenceTransformer 模型（仅一次）。"""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover
            raise EmbeddingError(
                "未安装 sentence-transformers，请先执行 pip install -r requirements.txt"
            ) from exc

        model_name = settings.embedding_model_name
        logger.info("加载向量化模型 %s (device=%s)...", model_name, settings.embedding_device)
        try:
            _model = SentenceTransformer(model_name, device=settings.embedding_device)
        except Exception as exc:
            raise EmbeddingError(
                f"向量化模型加载失败（{model_name}）：{exc}。"
                "若为网络问题，可设置 HF_ENDPOINT 或预下载模型后配置本地路径。"
            ) from exc
        logger.info("向量化模型加载完成：%s", model_name)
        return _model


def embedding_ready() -> bool:
    """模型是否已加载（不触发加载）。"""
    return _model is not None


def embed_texts(texts: list[str]) -> list[list[float]]:
    """将一批文本编码为向量。texts 为空时返回空列表。

    说明：bge-base-zh-v1.5 官方文档建议 query 侧加检索指令前缀，
    但实测（余弦相似度）在本中文医疗场景下不加指令相关性更高，故统一不加。
    """
    if not texts:
        return []
    model = _load_model()
    vectors = model.encode(
        texts,
        batch_size=settings.embedding_batch_size,
        show_progress_bar=False,
        normalize_embeddings=True,  # 归一化后直接以余弦相似度使用
        convert_to_numpy=True,
    )
    return vectors.tolist()
