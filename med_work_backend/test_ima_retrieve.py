"""独立测试脚本：直接调 IMA HTTP，验证订阅库能否通过 search_knowledge 取到 snippet。
仅用标准库 urllib + ssl，凭证读自 .env。
"""
import io
import json
import os
import sys
import urllib.request

# 解决 Windows 控制台 GBK 编码下 emoji 输出报错
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

env_path = os.path.join(ROOT, ".env")
if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

CLIENT_ID = os.environ.get("IMA_OPENAPI_CLIENTID", "")
API_KEY = os.environ.get("IMA_OPENAPI_APIKEY", "")
BASE = "https://ima.qq.com"


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "ima-openapi-clientid": CLIENT_ID,
            "ima-openapi-apikey": API_KEY,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _extract_data(body: dict) -> dict:
    data = body.get("data") or {}
    if isinstance(data, list):
        return {"items": data}
    return data if isinstance(data, dict) else {}


def main() -> None:
    print("== 1. 拉取全部可访问知识库 ==")
    base_resp = post("/openapi/wiki/v1/search_knowledge_base", {"query": "", "cursor": "", "limit": 20})
    data = _extract_data(base_resp)
    raw = data.get("info_list") or []
    # IMA 实际字段：kb_id / kb_name
    bases = [
        {
            "id": b.get("kb_id"),
            "name": b.get("kb_name"),
            "base_type": b.get("base_type"),
            "role_type": b.get("role_type"),
        }
        for b in raw
    ]
    print(f"返回 {len(bases)} 个")
    for b in bases:
        print(f"  - id={b.get('id')}  name={b.get('name')}  "
              f"base_type={b.get('base_type')}  role={b.get('role_type')}")

    subscribed = [b for b in bases if "订阅" in (b.get("base_type") or "")]
    if not subscribed:
        print("\n没有订阅型知识库")
        return

    kb_name = subscribed[0].get("name")
    kb_id = subscribed[0].get("id")
    print(f"\n== 2. 对订阅库做语义检索：name={kb_name}  id={kb_id} ==")

    query = "高血压"
    payload = {"query": query, "cursor": "", "knowledge_base_id": kb_id}
    print(f"payload = {json.dumps(payload, ensure_ascii=False)}")
    resp = post("/openapi/wiki/v1/search_knowledge", payload)
    print("搜索原始响应:", json.dumps(resp, ensure_ascii=False)[:800])
    data = _extract_data(resp)
    raw_hits = data.get("info_list") or data.get("hits") or data.get("items") or []
    print(f"命中 {len(raw_hits)} 条；data keys = {list(data.keys())}")
    for i, h in enumerate(raw_hits[:5], 1):
        snippet = (h.get("snippet") or h.get("highlight_content") or h.get("content") or "").strip()
        print(f"  [{i}] title={h.get('title')!r}  media_id={h.get('media_id')}")
        print(f"      highlight/snippet({len(snippet)}字)={snippet[:240]!r}{'...' if len(snippet) > 240 else ''}")

    if not raw_hits:
        return

    # 取第一条 media_id 试 get_media_info / get_doc_content，看平台对订阅库文件原文的真正限制
    target_media = raw_hits[0]["media_id"]
    print(f"\n== 3. 试 get_media_info 拉第一个命中文件原文（media_id={target_media[:60]}…）==")
    try:
        info_resp = post("/openapi/wiki/v1/get_media_info", {"media_id": target_media})
        print("get_media_info 响应:", json.dumps(info_resp, ensure_ascii=False)[:600])
    except urllib.error.HTTPError as e:
        print(f"get_media_info HTTPError {e.code}: {e.read().decode('utf-8', errors='replace')[:400]}")

    print("\n== 4. 试 get_doc_content 拉正文 ==")
    try:
        doc_resp = post("/openapi/wiki/v1/get_doc_content", {"media_id": target_media})
        print("get_doc_content 响应:", json.dumps(doc_resp, ensure_ascii=False)[:600])
    except urllib.error.HTTPError as e:
        print(f"get_doc_content HTTPError {e.code}: {e.read().decode('utf-8', errors='replace')[:400]}")


if __name__ == "__main__":
    main()