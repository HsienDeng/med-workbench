# MedWorkbench 后端双进程拆分（服务 A：Agent 主服务 / 服务 B：RAG 服务）

本文档记录本次架构拆分的落地结果、目录结构、关键改动、启动方式、迁移注意与回滚方案。
原始整体架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 1. 拆分后完整目录树

```
med_workbench/
├── README.md
├── med_work_backend/                 # 服务 A：Agent 主服务（对外 8001，前端对接）
│   ├── .env / .env.example           # 数据库、Redis、AI 提供商、RAG_SERVICE_BASE_URL（不含 RAG 本地配置）
│   ├── requirements.txt              # 新增 langgraph；已移除 qdrant/sentence-transformers/pypdf/docx
│   ├── AGENTS.md
│   ├── scripts/download_embedding_model.py   # 模型下载（供服务 B 引用）
│   ├── docs/ARCHITECTURE.md
│   ├── docs/SPLIT_ARCHITECTURE.md    # 本文档
│   └── app/
│       ├── main.py                   # FastAPI 工厂（/api 全部接口）
│       ├── config.py                 # 三提供商路由 + Redis 优先级 + RAG_SERVICE_BASE_URL
│       ├── database.py / redis_client.py / deps.py / exceptions.py / security.py
│       ├── models/                   # 全部 med_* 业务表（含 med_documents / med_document_chunks 元数据）
│       ├── schemas/                  # 请求/响应模型（含知识库 DocumentOut 等，字段与服务 B 对齐）
│       ├── clients/
│       │   ├── ai_provider.py        # 提供商路由（数据库配置，管理页切换）
│       │   ├── ai_connections.py     # 连接状态投影
│       │   ├── llm.py                # LLM 封装（get_llm / analyze_record）
│       │   └── ima_client.py         # IMA 外部集成（保留在服务 A）
│       ├── services/
│       │   ├── auth_service.py / menu_service.py / seed.py
│       │   ├── rag_proxy.py          # ★ RAG 服务 HTTP 代理客户端
│       │   └── agent_service.py      # ★ LangGraph Agent（会话记忆/工具/安全节点）
│       └── routers/
│           ├── chat.py               # /chat /chat/stream（Agent）+ /analysis
│           ├── knowledge.py          # /knowledge/* 代理转发 + IMA 部分保留
│           ├── ai.py / auth.py / health.py / menu.py / users.py ...
│
└── med_rag_service/                  # 服务 B：独立 RAG 服务（对内 8002，不暴露前端）
    ├── .env / .env.example           # 数据库、UPLOAD_DIR、QDRANT_PATH、EMBEDDING、CHUNK、LLM_CHUNKING
    ├── requirements.txt              # 不含 langchain/langgraph/redis
    ├── README.md
    └── app/
        ├── main.py                   # 无鉴权 FastAPI 工厂（内部 /internal/* + /health）
        ├── config.py                 # RAG 侧全部配置
        ├── database.py               # 与 med_work_backend 共用同一 MySQL 实例
        ├── exceptions.py             # AppError 体系（MED_XXX 错误码一致）
        ├── models/knowledge.py       # Document / DocumentChunk（表结构与 A 完全一致）
        ├── schemas/knowledge.py      # 知识库响应模型
        ├── clients/llm_client.py     # OpenAI 兼容客户端（httpx 直连，仅切分/摘要）
        ├── services/
        │   ├── chunking_service.py   # LLM 语义切分 + 规则回退（算法与 A 原实现一致）
        │   ├── embedding_service.py  # bge-base-zh-v1.5 懒加载
        │   ├── qdrant_service.py     # Qdrant local 模式
        │   └── document_service.py   # 文档入库/查询/删除/检索
        └── routers/documents.py      # 内部 API（全部强制 hospital_id）
```

## 2. 服务 A 关键修改文件

### 2.1 `app/config.py`：移除 RAG 本地配置，新增代理配置

```python
# ===== RAG 服务（服务 B）=====
upload_dir: str = "./data/uploads"              # 仅参考信息，本进程不写磁盘
rag_service_base_url: str = "http://127.0.0.1:8002"
rag_service_timeout: float = 300.0
```

已移除：`qdrant_path / embedding_model_name / embedding_device / embedding_batch_size / chunk_size / chunk_overlap / llm_chunking / llm_chunk_max_input / max_upload_mb`。

### 2.2 `app/services/rag_proxy.py`：知识库 HTTP 代理（核心）

```python
async def _request(method: str, path: str, **kwargs: Any) -> dict:
    try:
        async with httpx.AsyncClient(timeout=settings.rag_service_timeout) as client:
            resp = await client.request(method, f"{_BASE_URL}{path}", **kwargs)
    except httpx.HTTPError as exc:
        raise _wrap_transport_error(exc) from exc   # → RagServiceUnavailable (503, MED_RAG_UNAVAILABLE)
    _raise_for_response(resp)                        # → 透传服务 B 的 code/message
    return resp.json()
```

对外函数：`upload_document / list_documents / get_overview / get_document / delete_document / reindex_document / search`，均以 `hospital_id` 为必传租户参数。

### 2.3 `app/routers/knowledge.py`：代理转发 + 鉴权前置

```python
@router.post("/documents/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    user: RbacUser = Depends(require_hospital_admin),   # 鉴权仍在本服务
    ...
) -> UploadResponse:
    content = await file.read()
    body = await rag_proxy.upload_document(
        hospital_id=user.hospital_id or 1,              # 携带租户透传
        file_name=file.filename or "unnamed",
        file_content=content, title=..., doc_type=...,
    )
    return UploadResponse.model_validate(body)
```

`/knowledge/ima/*` 三个 IMA 接口原样保留在本服务。

### 2.4 `app/services/agent_service.py`：LangGraph Agent（chat 改造核心）

图结构：`START → safety_in →(危险→) safety_out` / `safety_in → agent →(工具)→ tools → agent → safety_out → END`

- 会话记忆：`InMemorySaver`（模块级单例）+ `thread_id = "user:{user.id}"`，跨请求共享；
- 工具 1 `search_knowledge_base`：闭包注入 `hospital_id`，经 `rag_proxy.search` 调服务 B；
- 工具 2 `search_ima_knowledge`：调 `ima_client`；
- 安全节点 `safety_in`：命中 `_BLOCKED_KEYWORDS`（自杀类）直接返回安全回复，不调 LLM；
- 输出节点 `safety_out`：在最终回复后追加医疗免责声明（`MEDICAL_DISCLAIMER`）；
- 流式：`astream(..., stream_mode=["messages", "updates"])`，只透出 `agent` 节点文本 token + 结尾免责声明增量，SSE 协议与旧版一致；
- **langgraph 全部延迟 import**（`from langgraph.graph import ...` 在 `_build_graph` 内），未安装 langgraph 时服务 A 仍可启动。

```python
@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user: RbacUser = Depends(get_current_user)):
    async def event_gen():
        try:
            async for piece in agent_service.chat_stream(req, user):
                yield f"data: {piece}\n\n"
        except Exception as exc:
            yield f"data: [ERROR] {exc}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(event_gen(), media_type="text/event-stream")
```

## 3. 服务 B 完整最小实现

已在 `med_rag_service/` 落地（见目录树），关键点：

- `app/clients/llm_client.py`：httpx 直连 OpenAI 兼容 `/chat/completions`，不引入 langchain/langgraph；
- `app/services/chunking_service.py`：LLM 语义切分（健康度校验 + 乱码检测 + 回退规则切分）算法与服务 A 原实现一致；
- `app/routers/documents.py`：`/internal/*` 全部接口，`hospital_id` 缺失/非法 → `MED_MISSING_TENANT`；
- `app/main.py`：`lifespan` 内 `Base.metadata.create_all`（幂等建 med_documents / med_document_chunks）；不做鉴权。

内部接口清单：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /internal/documents/upload | multipart，hospital_id 在 form |
| GET | /internal/documents | 列表（hospital_id query） |
| GET | /internal/documents/overview | 统计 |
| GET | /internal/documents/{id} | 详情（含分块） |
| DELETE | /internal/documents/{id} | 删除（软删+清向量） |
| POST | /internal/documents/{id}/reindex | 重建索引 |
| GET | /internal/search | 语义检索 |
| GET | /health | 健康检查 |

## 4. 启动命令

### 依赖安装（首次）

```bash
# 服务 A（已含 langgraph）
cd med_work_backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt

# 服务 B
cd ../med_rag_service
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
```

### 启动两个服务（各自独立进程）

```bash
# 终端 1：服务 B（RAG，先启动，保证服务 A 代理可用）
cd med_rag_service
.venv\Scripts\activate
uvicorn app.main:app --host 127.0.0.1 --port 8002

# 终端 2：服务 A（对外 8001）
cd med_work_backend
.venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

### Docker（示意）

```dockerfile
# med_rag_service/Dockerfile（服务 B）
FROM python:3.11-slim
WORKDIR /srv/rag
COPY requirements.txt .
RUN pip install -r requirements.txt && python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-base-zh-v1.5')"
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
```

```dockerfile
# med_work_backend/Dockerfile（服务 A）
FROM python:3.11-slim
WORKDIR /srv/med
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

```yaml
# docker-compose.yml（示意）
services:
  rag:
    build: ./med_rag_service
    environment:
      DB_HOST: mysql
      RAG_SERVICE_PORT: 8002
    volumes: [rag_data:/srv/rag/data]
    networks: [internal]
  api:
    build: ./med_work_backend
    environment:
      DB_HOST: mysql
      REDIS_HOST: redis
      RAG_SERVICE_BASE_URL: http://rag:8002
    ports: ["8001:8001"]
    networks: [internal]
  mysql: ...
  redis: ...
```

### `.env` 拆分要点

- 服务 A（`med_work_backend/.env`）：`DB_* / REDIS_* / MED_API_KEY_ENC_KEY / UPLOAD_DIR(参考) / RAG_SERVICE_BASE_URL / RAG_SERVICE_TIMEOUT`（AI 供应商凭据存数据库，管理页维护）；
- 服务 B（`med_rag_service/.env`）：`DB_* / UPLOAD_DIR / QDRANT_PATH / EMBEDDING_MODEL_NAME / EMBEDDING_DEVICE / EMBEDDING_BATCH_SIZE / CHUNK_SIZE / CHUNK_OVERLAP / MAX_UPLOAD_MB / LLM_CHUNKING / LLM_CHUNK_MAX_INPUT / LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_TIMEOUT`。

## 5. 迁移注意事项与回滚方案

### 注意事项

1. **先启 B 再启 A**：服务 A 的 `/knowledge/*` 依赖服务 B；B 未启动时知识库接口返回 `503 MED_RAG_UNAVAILABLE`（聊天与登录不受影响）。
2. **Qdrant 数据迁移**：旧向量库在 `med_work_backend/data/qdrant`，新服务 B 使用 `med_rag_service/data/qdrant`（本次已实测为空库）。迁移时把旧目录复制到 `med_rag_service/data/qdrant`；**建议直接对存量文档调用 reindex 重建**，更保险。
3. **上传目录迁移**：旧文件在 `med_work_backend/data/uploads`，服务 B 的 `UPLOAD_DIR` 需指向该目录（或把文件复制过去，保持 `hospital_{id}/` 结构）。
4. **MySQL 表结构**：`med_documents / med_document_chunks` 由服务 B 在启动时幂等 `create_all`，表结构不变，无需数据迁移。
5. **langgraph 未安装**：本次仅写入 `requirements.txt`（按约定未执行 pip）。运行前需 `pip install -r requirements.txt`；未安装时服务 A 可启动，但 `/chat` 会报 `MED_AI_CALL_FAILED`。
6. **LLM 切分凭证**：服务 B 的 `LLM_API_KEY`（语义切分）需独立配置，与服务 A 的 AI 提供商（数据库管理页维护）无关。
7. **多租户**：服务 B 所有接口强制 `hospital_id`，缺失/非法返回 `MED_MISSING_TENANT`；服务 A 转发时取 `user.hospital_id`，不会串租户。
8. **对话记忆**：Agent 会话记忆为进程内存（`InMemorySaver`），重启服务 A 会丢失；如需持久化可后续替换为 `langgraph-checkpoint` 的 MySQL/Redis 后端。
9. **安全**：服务 B 仅监听 `127.0.0.1`（或内网），勿暴露公网；服务 A 仍持有全部鉴权。

### 回滚方案

1. **代码回滚**：`git checkout main -- med_work_backend`（拆分改动若未提交，用 `git stash` 或直接撤销工作区）；`med_rag_service/` 为新增目录，删除即可。
2. **数据库**：本次拆分未改任何表结构/数据，MySQL 无回滚负担。
3. **运行方式**：旧版单进程 `cd med_work_backend && uvicorn app.main:app --port 8001` 可直接恢复；`.env` 需恢复 `QDRANT_PATH / EMBEDDING_MODEL_NAME` 等配置（旧 `.env.example` 有留存，或从 git 历史取回）。
4. **frontend 兼容**：接口路径与 SSE 协议未变，前端无需改动，回滚亦不影响前端。

## 6. 已执行验证（本次落地）

- 服务 B：`compileall` + `create_app` + 端到端冒烟（上传 txt → LLM 切分 → bge 向量化 → Qdrant 检索命中 score 0.666 → 删除清理）✔
- 服务 A：`compileall` + `create_app`（10 路由）+ lint 0 错误 ✔
- 代理链路：启动服务 B 后，服务 A `rag_proxy.search / overview / list` 实测通过 ✔
- 待办：`pip install -r requirements.txt`（安装 langgraph）后实测 `/chat` Agent 链路。
