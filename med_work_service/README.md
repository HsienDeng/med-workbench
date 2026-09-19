# MedWorkbench RAG 服务（服务 B）

独立 RAG 服务，承载本地知识库全链路：上传落盘、文本解析、LLM 语义切分（失败回退规则）、
bge-base-zh-v1.5 本地向量化、Qdrant 本地向量库。

## 职责边界

- **持有**：本地磁盘 `UPLOAD_DIR`、Qdrant 本地向量库、本地 embedding 模型、MySQL 中
  `med_documents` / `med_document_chunks` 两张表的读写。
- **不做**：登录鉴权、AI 对话、IMA 集成。这些全部由服务 A（`med_work_backend`）承担，
  本服务通过 HTTP 被服务 A 代理调用。
- **多租户**：所有接口必须携带 `hospital_id`，否则拒绝（`MED_MISSING_TENANT`）。

## 目录结构

```
med_rag_service/
├── .env / .env.example     # 配置（数据库 / 上传目录 / Qdrant / 模型 / LLM 切分）
├── requirements.txt
├── README.md
└── app/
    ├── main.py             # FastAPI 应用工厂 + 全局异常处理
    ├── config.py           # pydantic-settings 配置
    ├── database.py         # SQLAlchemy 2.0 引擎（与服务 A 共用 MySQL）
    ├── exceptions.py       # AppError 异常体系（错误码 MED_XXX 不变）
    ├── models/
    │   └── knowledge.py    # Document / DocumentChunk ORM
    ├── schemas/
    │   └── knowledge.py    # 知识库响应模型
    ├── clients/
    │   └── llm_client.py   # OpenAI 兼容 LLM 客户端（仅用于切分/摘要，httpx 直连）
    ├── services/
    │   ├── chunking_service.py    # LLM 语义切分 + 规则回退
    │   ├── embedding_service.py   # bge-base-zh-v1.5 懒加载向量化
    │   ├── qdrant_service.py      # Qdrant local 模式封装
    │   └── document_service.py    # 文档入库/查询/删除/检索
    └── routers/
        └── documents.py    # 内部 HTTP API（/internal/*）
```

## 内部接口（仅内网，由服务 A 代理）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /internal/documents/upload | multipart 上传（hospital_id 在 form 字段） |
| GET | /internal/documents | 文档列表（hospital_id query） |
| GET | /internal/documents/overview | 知识库统计 |
| GET | /internal/documents/{id} | 文档详情（含分块） |
| DELETE | /internal/documents/{id} | 删除（软删 + 清向量） |
| POST | /internal/documents/{id}/reindex | 重建索引 |
| GET | /internal/search | 语义检索（q + hospital_id + limit） |
| GET | /health | 健康检查（DB / embedding / 向量库状态） |

## 启动

```bash
cd med_rag_service
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
copy .env.example .env            # 按实际环境填写
uvicorn app.main:app --host 127.0.0.1 --port 8002
```

安全提示：默认监听 `127.0.0.1` 即可（服务 A 同机代理）；若跨机部署，
务必限制监听内网网卡并配合防火墙，不要暴露公网。

## 依赖说明

- 不包含 langchain / langgraph（LLM 切分使用轻量 httpx 客户端直连 OpenAI 兼容 API）。
- 首次启动上传文档时才会真正加载 bge 模型（懒加载），启动本身不加载模型。
- 模型默认走 `hf-mirror.com` 镜像（可设 `HF_ENDPOINT` 覆盖）。
