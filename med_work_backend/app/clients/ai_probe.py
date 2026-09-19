"""AI 供应商连通性探测：测速 + 模型列表拉取。

- OpenAI 兼容：GET {base_url}/models，Authorization: Bearer <key>
- Anthropic：GET {base_url}/models（x-api-key）；网关不支持时回退
  POST {base_url}/messages 最小请求（max_tokens=1）仅测连通性
"""

import logging
import time

import httpx

logger = logging.getLogger(__name__)

PROBE_TIMEOUT_SECONDS = 10.0
_ANTHROPIC_VERSION = "2023-06-01"
_ANTHROPIC_FALLBACK_MODEL = "claude-3-5-haiku-latest"


def _openai_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def _anthropic_headers(api_key: str) -> dict[str, str]:
    return {"x-api-key": api_key, "anthropic-version": _ANTHROPIC_VERSION}


def _parse_models(payload: object) -> list[str]:
    """解析 OpenAI / Anthropic 同构的 {"data": [{"id": ...}]} 响应。"""
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    ids = [item.get("id") for item in data if isinstance(item, dict) and item.get("id")]
    return sorted(set(str(model_id) for model_id in ids))


def _result(ok: bool, latency_ms: int | None, models: list[str], error: str | None) -> dict:
    return {"ok": ok, "latency_ms": latency_ms, "models": models, "error": error}


async def _probe_anthropic_messages(
    base_url: str, api_key: str, default_model: str
) -> dict:
    """Anthropic 网关不支持 GET /models 时，用最小消息请求测连通。"""
    url = f"{base_url.rstrip('/')}/messages"
    payload = {
        "model": default_model or _ANTHROPIC_FALLBACK_MODEL,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "ping"}],
    }
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, headers=_anthropic_headers(api_key), json=payload)
    except httpx.TimeoutException:
        return _result(False, None, [], "连接超时（10 秒），请检查网络或网关地址")
    except httpx.HTTPError as exc:
        return _result(False, None, [], f"网络错误：{exc.__class__.__name__}")
    latency_ms = int((time.perf_counter() - start) * 1000)
    if resp.status_code in (200, 400):
        # 200 正常响应；400 通常是模型名不合法，但凭据与网关连通性已验证
        return _result(True, latency_ms, [], None if resp.status_code == 200 else "网关连通，但默认模型可能不可用，请重新选择模型")
    detail = resp.text[:200]
    if resp.status_code in (401, 403):
        return _result(False, latency_ms, [], f"API Key 无效或无权限（HTTP {resp.status_code}）")
    return _result(False, latency_ms, [], f"上游返回 HTTP {resp.status_code}：{detail}")


async def probe_provider(
    protocol: str, base_url: str, api_key: str, default_model: str = ""
) -> dict:
    """探测供应商连通性；返回 {ok, latency_ms, models, error}。

    成功时 models 为可用模型列表（Anthropic 消息回退通道除外，返回空列表）。
    """
    if not api_key:
        return _result(False, None, [], "API Key 未配置")
    if not base_url.strip():
        return _result(False, None, [], "Base URL 未配置")

    url = f"{base_url.rstrip('/')}/models"
    headers = _anthropic_headers(api_key) if protocol == "anthropic" else _openai_headers(api_key)
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        return _result(False, None, [], "连接超时（10 秒），请检查网络或网关地址")
    except httpx.HTTPError as exc:
        return _result(False, None, [], f"网络错误：{exc.__class__.__name__}")
    latency_ms = int((time.perf_counter() - start) * 1000)

    if resp.status_code == 200:
        models = _parse_models(resp.json())
        return _result(True, latency_ms, models, None)
    if protocol == "anthropic" and resp.status_code in (404, 405):
        return await _probe_anthropic_messages(base_url, api_key, default_model)
    if resp.status_code in (401, 403):
        return _result(False, latency_ms, [], f"API Key 无效或无权限（HTTP {resp.status_code}）")
    detail = resp.text[:200]
    return _result(False, latency_ms, [], f"上游返回 HTTP {resp.status_code}：{detail}")
