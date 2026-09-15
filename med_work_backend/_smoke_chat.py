"""一次性冒烟：验证 AI 助手回答的知识库引用（citations）链路。

1. 登录后端 A（8001）取 token；
2. POST /api/chat/stream 提问 → 期望收尾出现 `[CITATIONS] <json>`；
3. POST /api/chat 提问 → 期望响应体带 citations 列表。

用法：.venv\\Scripts\\python.exe -X utf8 _smoke_chat.py
"""
import json
import sys

import httpx

BASE = "http://127.0.0.1:8001"
USER = "admin"
PASSWORD = "admin123"


def main() -> int:
    timeout = httpx.Timeout(connect=10, read=420, write=60, pool=60)
    with httpx.Client(timeout=timeout, base_url=BASE) as c:
        login = c.post("/api/auth/login", json={"account": USER, "password": PASSWORD})
        if login.status_code != 200:
            print(f"[FAIL] 登录失败 {login.status_code}: {login.text[:200]}")
            return 1
        token = login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        print(f"[OK] 登录成功 admin")

        question = "阿司匹林肠溶片一次吃多少？"
        # 1) 流式（收到 [CITATIONS] 或 [DONE] 即主动断开，避免长回复空等）
        with c.stream(
            "POST",
            "/api/chat/stream",
            headers=headers,
            json={"messages": [{"role": "user", "content": question}]},
        ) as resp:
            print(f"stream status={resp.status_code}")
            body = ""
            citations_raw = None
            done = False
            try:
                for line in resp.iter_lines():
                    if not line:
                        continue
                    body += line + "\n"
                    if line.startswith("data: [CITATIONS]"):
                        citations_raw = line[len("data: ") :]
                    if line.startswith("data: [DONE]") or citations_raw:
                        done = True
                        break
            except (httpx.ReadTimeout, httpx.RemoteProtocolError):
                pass  # 已拿到关键信息即可
            print(f"stream 提前断开 done={done}")
            if citations_raw:
                citations = json.loads(citations_raw.replace("[CITATIONS] ", "", 1))
                print(f"[OK] stream [CITATIONS] 事件：{len(citations)} 条引用")
                for c2 in citations:
                    print(f"  - {c2['title']} ({c2['score']}) {c2['snippet'][:40]}")
            else:
                tail = body[-300:]
                print("[WARN] 未捕获 [CITATIONS] 事件，响应尾部：", tail)
        # 2) 非流式
        r = c.post(
            "/api/chat",
            headers=headers,
            json={"messages": [{"role": "user", "content": question}]},
        )
        if r.status_code == 200:
            data = r.json()
            print(f"[OK] /chat status=200, citations={len(data.get('citations') or [])}")
            for c3 in data.get("citations") or []:
                print(f"  - {c3['title']} ({c3['score']})")
            print("回复开头：", (data.get("content") or "")[:120].replace("\n", " "))
        else:
            print(f"[FAIL] /chat {r.status_code}: {r.text[:300]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
