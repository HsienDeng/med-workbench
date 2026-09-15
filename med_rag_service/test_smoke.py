"""med_rag_service 端到端冒烟测试：上传→检索→总览→删除（验证后自动清理测试数据）。"""
import os
import tempfile

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

print("== health ==")
r = client.get("/health")
print(r.status_code, r.json())

content = (
    "肺结核诊断和治疗指南\n"
    "一、概述\n肺结核是由结核分枝杆菌感染引起的慢性传染病，主要通过呼吸道飞沫传播。\n"
    "二、诊断标准\n1. 临床表现：咳嗽咳痰两周以上，伴咯血、胸痛、发热、盗汗、乏力等。\n"
    "2. 影像学：胸部X线或CT提示肺部浸润影、空洞或播散病灶。\n"
    "3. 病原学：痰涂片抗酸染色阳性、培养阳性或分子检测阳性。\n"
    "三、治疗原则\n初治敏感肺结核采用2HRZE/4HR方案，即异烟肼、利福平、吡嗪酰胺、乙胺丁醇强化期两个月，巩固期四个月。\n"
    "耐药结核需根据药敏结果个体化治疗。\n"
    "四、预防\n新生儿接种卡介苗，密切接触者筛查预防性治疗。\n"
)

fd, path = tempfile.mkstemp(suffix=".txt")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write(content)

print("\n== upload ==")
with open(path, "rb") as f:
    r = client.post(
        "/internal/documents/upload",
        data={
            "hospital_id": 1,
            "title": "肺结核诊断和治疗指南（冒烟测试）",
            "doc_type": "guide",
            "source_type": "system",
            "remark": "med_rag_service smoke test",
        },
        files={"file": ("tb_guide_smoke.txt", f, "text/plain")},
    )
os.unlink(path)
print(r.status_code)
body = r.json()
if r.status_code != 200:
    print("UPLOAD FAILED:", body)
    raise SystemExit(1)
doc = body["document"]
print("doc:", doc["id"], doc["title"], "status:", doc["status"], "chunks:", doc["chunk_count"])
if doc["status"] != "ready":
    print("ERROR:", doc.get("error_message"))
    raise SystemExit(1)

doc_id = doc["id"]

print("\n== overview ==")
r = client.get("/internal/documents/overview", params={"hospital_id": 1})
print(r.status_code, {k: r.json().get(k) for k in ("total_documents", "ready_documents", "total_chunks", "embedding_ready", "vector_db_connected")})

print("\n== search ==")
r = client.get("/internal/search", params={"hospital_id": 1, "q": "肺结核治疗", "limit": 5})
print(r.status_code, "total:", r.json().get("total"))
for h in r.json().get("hits", [])[:3]:
    print("  hit:", h["title"], "| score:", h["score"], "| content:", h["content"][:30])

print("\n== list ==")
r = client.get("/internal/documents", params={"hospital_id": 1, "keyword": "冒烟测试"})
print(r.status_code, "total:", r.json().get("total"))

print("\n== detail ==")
r = client.get(f"/internal/documents/{doc_id}", params={"hospital_id": 1})
print(r.status_code, "chunks:", len(r.json().get("chunks", [])))

print("\n== delete (cleanup) ==")
r = client.delete(f"/internal/documents/{doc_id}", params={"hospital_id": 1})
print(r.status_code, r.json())

print("\nSMOKE TEST PASSED")
