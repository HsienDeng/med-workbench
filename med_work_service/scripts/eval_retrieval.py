"""本地知识库检索质量评测：量化 bge 向量检索的召回/排序水平。

使用（在 med_rag_service 目录下，用本服务 .venv，需先上传种子文档）：
    .venv\\Scripts\\python.exe scripts\\eval_retrieval.py
    .venv\\Scripts\\python.exe scripts\\eval_retrieval.py --report scripts/eval_report.md

评测方法：
- 内置 query 集（含标准表述/口语化/同义改写），每条标注应命中的文档标题关键词；
- 调 /internal/search 取 top-N，文档级判定：命中标题归一化后包含任一标注关键词；
- 指标：Recall@5 / Recall@10、MRR@10、nDCG@10（二值相关）、top1 分数分布；
- 逐条明细 + 汇总写入 markdown 报告，同时打印到控制台。
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime

import httpx

BASE = "http://127.0.0.1:8002"
HOSPITAL_ID = 1


def _norm(text: str) -> str:
    return re.sub(r"[\s《》「」（）()·—–、，。：:.\-]", "", (text or "")).lower()


# (query, 应命中文档的标题关键词；用于 doc 级相关性判定)
CASES: list[tuple[str, list[str]]] = [
    ("高血压的诊断标准是什么", ["高血压防治指南"]),
    ("血压160/100属于几级", ["高血压防治指南"]),
    ("高血压患者每天盐摄入量应该少于多少", ["高血压防治指南"]),
    ("阿司匹林肠溶片一次吃多少", ["阿司匹林"]),
    ("吃阿司匹林出现黑便怎么办", ["阿司匹林"]),
    ("二甲双胍的起始剂量是多少", ["二甲双胍"]),
    ("肾功能不好能用二甲双胍吗", ["二甲双胍"]),
    ("糖尿病的诊断切点是多少", ["2型糖尿病防治指南"]),
    ("糖化血红蛋白降到多少算达标", ["2型糖尿病防治指南"]),
    ("硝苯地平引起脚踝水肿正常吗", ["硝苯地平"]),
    ("社区获得性肺炎常见致病菌有哪些", ["社区获得性肺炎"]),
    ("肺炎抗感染治疗一般要几天", ["社区获得性肺炎"]),
    ("心梗黄金抢救时间是多久", ["心肌梗死"]),
    ("脑梗溶栓的时间窗是几个小时", ["脑卒中"]),
    ("rt-PA溶栓的血压要求", ["脑卒中"]),
    ("慢阻肺稳定期用什么药", ["慢阻肺"]),
    ("首次病程记录要在入院几小时内完成", ["病历书写"]),
    ("抢救记录要在几小时内补记", ["病历书写"]),
    ("低密度脂蛋白降到多少合适", ["血脂异常"]),
    ("他汀类药物有哪些副作用", ["血脂异常"]),
]


def fetch_hits(client: httpx.Client, query: str, limit: int) -> list[dict]:
    resp = client.get(
        f"{BASE}/internal/search",
        params={"hospital_id": HOSPITAL_ID, "q": query, "limit": limit},
    )
    resp.raise_for_status()
    return resp.json().get("hits") or []


def evaluate_case(client: httpx.Client, query: str, relevant: list[str], limit: int) -> dict:
    hits = fetch_hits(client, query, limit)
    rel_norm = [_norm(r) for r in relevant]

    def is_rel(title: str) -> bool:
        t = _norm(title)
        return any(r and (r in t or t in r) for r in rel_norm)

    flags = [is_rel(h.get("title", "")) for h in hits]

    recall5 = 1.0 if any(flags[:5]) else 0.0
    recall10 = 1.0 if any(flags[:10]) else 0.0
    mrr = 0.0
    for i, f in enumerate(flags, 1):
        if f:
            mrr = 1.0 / i
            break
    # nDCG@10（二值 gains，理想 DCG = 1）
    dcg = sum((1.0 / math.log2(i + 2)) for i, f in enumerate(flags[:10]) if f)
    ndcg = dcg
    top_scores = [float(h.get("score") or 0) for h in hits[:10]]
    first_rel_score = next((s for s, f in zip(top_scores, flags) if f), None)
    return {
        "query": query,
        "expected": relevant,
        "recall5": recall5,
        "recall10": recall10,
        "mrr": mrr,
        "ndcg": ndcg,
        "n_hits": len(hits),
        "first_rel_rank": (flags.index(True) + 1) if True in flags else None,
        "top1_score": top_scores[0] if top_scores else None,
        "first_rel_score": first_rel_score,
        "hits": hits[:10],
        "flags": flags,
    }


def main() -> int:
    global BASE, HOSPITAL_ID
    parser = argparse.ArgumentParser(description="本地知识库检索质量评测")
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--hospital-id", type=int, default=HOSPITAL_ID)
    parser.add_argument("--limit", type=int, default=10, help="每条 query 取回的候选数")
    parser.add_argument("--report", default=None, help="报告输出路径（markdown）")
    parser.add_argument("--json", dest="as_json", action="store_true", help="仅输出 JSON 汇总")
    args = parser.parse_args()
    BASE = args.base.rstrip("/")
    HOSPITAL_ID = args.hospital_id

    limit = max(args.limit, 10)
    results: list[dict] = []
    with httpx.Client(timeout=60) as client:
        for query, relevant in CASES:
            try:
                results.append(evaluate_case(client, query, relevant, limit))
            except Exception as exc:  # noqa: BLE001
                print(f"[ERROR] {query}: {exc}")
                results.append({"query": query, "error": str(exc)})

    ok = [r for r in results if "error" not in r]
    n = len(ok)
    if not n:
        print("[ERROR] 无可用用例，请确认 RAG 服务已启动且种子文档已上传")
        return 1
    summary = {
        "cases": n,
        "recall@5": sum(r["recall5"] for r in ok) / n,
        "recall@10": sum(r["recall10"] for r in ok) / n,
        "mrr@10": sum(r["mrr"] for r in ok) / n,
        "ndcg@10": sum(r["ndcg"] for r in ok) / n,
        "top1_score_mean": (
            sum(r["top1_score"] for r in ok if r["top1_score"] is not None)
            / max(1, sum(1 for r in ok if r["top1_score"] is not None))
        ),
        "top1_score_min": min(
            (r["top1_score"] for r in ok if r["top1_score"] is not None), default=None
        ),
        "first_rel_score_min": min(
            (r["first_rel_score"] for r in ok if r["first_rel_score"] is not None), default=None
        ),
    }

    if args.as_json:
        print(json.dumps({"summary": summary, "results": ok}, ensure_ascii=False, indent=2))
        return 0

    lines: list[str] = []
    lines.append("# 知识库检索质量评测报告")
    lines.append("")
    lines.append(f"- 时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"- 服务：{BASE}（hospital_id={HOSPITAL_ID}）")
    lines.append("- 语料：scripts/seed_demo_documents.py 上传的种子文档（doc 级判定）")
    lines.append(f"- 用例数：{n}")
    lines.append("")
    lines.append("## 汇总")
    lines.append("")
    lines.append("| 指标 | 数值 |")
    lines.append("| --- | --- |")
    lines.append(f"| Recall@5 | {summary['recall@5']:.1%} |")
    lines.append(f"| Recall@10 | {summary['recall@10']:.1%} |")
    lines.append(f"| MRR@10 | {summary['mrr@10']:.3f} |")
    lines.append(f"| nDCG@10 | {summary['ndcg@10']:.3f} |")
    lines.append(f"| top1 分数均值 | {summary['top1_score_mean']:.3f} |")
    lines.append(f"| top1 分数最低 | {summary['top1_score_min']:.3f} |")
    lines.append(f"| 首个相关命中分数最低 | {summary['first_rel_score_min']:.3f} |")
    lines.append("")
    lines.append("## 逐条明细")
    lines.append("")
    lines.append("| # | Query | 期望文档 | Recall@5 | 首个相关排名 | MRR | top1 分数 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for i, r in enumerate(ok, 1):
        rank = r["first_rel_rank"] or "-"
        lines.append(
            f"| {i} | {r['query']} | {'、'.join(r['expected'])} "
            f"| {'Y' if r['recall5'] else 'N'} | {rank} | {r['mrr']:.3f} "
            f"| {r['top1_score']:.3f} |"
        )
    report = "\n".join(lines) + "\n"
    print(report)

    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"[OK] 报告已写入 {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
