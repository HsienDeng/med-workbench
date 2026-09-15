"""OpenAI 兼容 LLM 客户端：仅用于文档语义切分与摘要生成。

直接以 httpx 调用 /chat/completions，避免在 RAG 服务引入 langchain / langgraph
等重型依赖；凭证、模型、地址由 med_rag_service/.env 注入。
"""

import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def chat_completion(
    system: str,
    user: str,
    *,
    temperature: float = 0.1,
    max_tokens: int | None = None,
) -> str:
    """调用配置的 OpenAI 兼容模型，返回纯文本内容。

    失败抛 httpx.HTTPError / KeyError 等，由调用方捕获后回退规则切分。
    """
    api_key = settings.llm_api_key.get_secret_value().strip()
    if not api_key:
        raise RuntimeError("LLM 语义切分凭证未配置（LLM_API_KEY）")

    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens

    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        json=payload,
        timeout=settings.llm_timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]
