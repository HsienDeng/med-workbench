# MedWorkbench 后端架构与实现说明

> 面向 AI 协作的架构参考文档。所有结论均以 `med_work_backend/` 下实际代码为准。
> 若在文档中读到与代码不一致之处，以代码为准，并请更新本文档。

- 技术栈：Python 3.11+ / FastAPI / SQLAlchemy 2.0 / Pydantic v2
- 存储：MySQL（业务数据）+ Redis（会话与路由）+ Qdrant 本地模式（向量）+ 本地磁盘（上传文件）
- 模型：LLM 供应商由数据库 `med_ai_provider_configs` 表配置（OpenAI 兼容 / Anthropic 协议，管理页维护）；Embedding 走本地 bge-base-zh-v1.5
- 启动入口：`app/main.py` 的 `create_app()`，uvicorn 挂载 `app.main:app`，路由统一前缀 `/api`

---

## 1. 分层架构

请求严格单向流动，**禁止反向依赖**（service/model 不得 import router）：

```
HTTP 请求
   ↓
routers/    参数校验(Query/Form/Depends)、鉴权依赖、调用 service、组装响应
   ↓
services/   业务规则、事务编排、领域状态机（纯业务，不含第三方 SDK）
   ↓
clients/    外部系统客户端（LLM 提供商 / IMA OpenAPI）
models/     SQLAlchemy ORM（表结构定义）
schemas/    Pydantic v2（入参校验与出参序列化）
```

依赖方向规则：
- `routers` → `services` + `clients` + `schemas` + `models`
- `services` → `models` + `clients` + `schemas`
- `clients` → `config` + `exceptions`（不得依赖 services，避免循环导入）

### 目录职责

| 目录/文件 | 职责 |
|---|---|
| `app/main.py` | 应用工厂、CORS、全局异常处理器、路由注册、`lifespan` 启动建表 |
| `app/config.py` | `Settings`（pydantic-settings），从环境变量/`.env` 读取；`settings` 单例 |
| `app/database.py` | SQLAlchemy engine（连接池）、`SessionLocal`、`Base`、`get_db` 依赖 |
| `app/deps.py` | `get_current_user`（Bearer 鉴权）、`require_hospital_admin`（角色校验） |
| `app/exceptions.py` | 统一业务异常基类与子类，携带 `status_code` / `code` / `message` |
| `app/security.py` | 密码哈希与校验 |
| `app/redis_client.py` | Redis 封装，连接失败抛 `RedisUnavailable`（不静默降级） |
| `app/routers/` | 5 个路由模块：`health` / `ai` / `auth` / `chat` / `knowledge` |
| `app/services/` | 纯业务服务（见 §3） |
| `app/clients/` | 外部客户端（见 §4） |
| `app/schemas/` | 按域拆分：`auth` / `chat` / `ai` / `knowledge` / `menu` |
| `app/models/` | ORM：`rbac` / `knowledge` / `menu` / `session` |

---

## 2. 配置模型

`app/config.py` 中 `Settings` 为唯一配置源，字段通过环境变量或 `.env` 注入（`extra="ignore"`）。

### AI 提供商路由

供应商（base_url / API Key / 默认模型 / 当前路由）全部存储在 `med_ai_provider_configs` 表，
由前端「AI 服务与 API Key」管理页维护（仅 `hospital_admin` 可写，操作记录审计日志）。

- 支持协议：OpenAI 兼容（`ChatOpenAI`）与 Anthropic（探测走 `/v1/messages`）
- API Key 以 AES-GCM 加密落库，密钥为 `MED_API_KEY_ENC_KEY`；解密仅发生在调用瞬间
- 当前路由 = `is_active` 单选行；`POST /api/ai/providers/{provider}/activate` 切换后**无需重启后端**

### 关键配置项

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MED_API_KEY_ENC_KEY` | 空（开发兜底） | 数据库中 API Key 的 AES-GCM 加密密钥；生产必配，配后勿变更 |
| `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY` | — | IMA 集成凭证，非空即视为授权数据出网 |
| `DB_*` | — | MySQL 连接；`database_url` 对密码做 URL 编码 |
| `REDIS_*` | — | Redis 连接；`SESSION_TTL_HOURS` 默认 12 小时 |
| `UPLOAD_DIR` | `./data/uploads` | 上传根目录，按 `hospital_{id}/` 分租户 |
| `QDRANT_PATH` | `./data/qdrant` | 向量落盘目录（Qdrant local 模式，无需独立服务） |
| `EMBEDDING_MODEL_NAME` | `BAAI/bge-base-zh-v1.5` | 可填 HF 模型名或本地绝对路径 |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `500` / `100` | 规则切分参数 |
| `LLM_CHUNKING` | `true` | 是否用 LLM 做语义切分与摘要，失败自动回退规则切分 |
| `MAX_UPLOAD_MB` | `50` | 上传大小上限 |

> **安全提示**：当前 `app/config.py` 中 `ima_openapi_clientid` / `ima_openapi_apikey` 带有**硬编码默认凭据**。按仓库规范（`AGENTS.md`）应改为空默认值、由 `.env` 注入，并轮换已泄露的密钥。

---

## 3. 业务服务层（`app/services/`）

仅保留纯业务服务，不含第三方 SDK：

| 模块 | 职责 |
|---|---|
| `auth_service.py` | RBAC 登录/注册/会话；Redis 为认证主路径、MySQL 为持久化源；连续失败 5 次锁定 15 分钟；角色缓存 TTL 300s |
| `document_service.py` | 知识库核心：上传落盘 → 解析 → 分块 → 向量化 → 入库 → 检索 → 删除 |
| `chunking_service.py` | 文本切分（LLM 语义切分 + 规则切分回退）与文档摘要 |
| `embedding_service.py` | 本地 bge 模型懒加载与批量向量化（`EMBEDDING_DIM = 768`，归一化后取余弦） |
| `qdrant_service.py` | Qdrant local 封装：集合初始化、upsert、按文档删点、租户过滤检索 |
| `menu_service.py` | 菜单与角色菜单查询 |
| `seed.py` | 启动时建表与演示账号/角色种子（`init_db()`，由 `lifespan` 调用） |

### 文档索引流水线（`document_service.create_document_and_index`）

```
校验扩展名(.pdf/.docx/.txt/.md) 与大小上限
  → 落盘到 upload_dir/hospital_{id}/{uuid}{ext}     # 磁盘名用 uuid，原名仅入 DB
  → 建 Document 记录，status="parsing"
  → extract_text()      按扩展名抽取纯文本
  → chunk_text()        LLM 语义切分，失败回退规则切分
  → summarize_text()    LLM 摘要（失败不中断）
  → embed_texts()       批量向量化（bge，768 维）
  → upsert_chunks()     写 Qdrant，point_id = uuid5(NAMESPACE_OID, "doc{id}-c{idx}")
  → 写 med_document_chunks，更新 chunk_count/vector_count，status="ready"
```

失败处理：`EmbeddingError` / `VectorDbError` 时文档标记 `failed` 并写入 `error_message`（截断 500 字），用户可在界面点「重建索引」重试。

### 语义检索（`search_knowledge`）

```
query → embed_texts → Qdrant topK(limit*2，按 hospital_id 过滤)
      → 回查 MySQL 文档元信息 → 过滤"幽灵向量"(库中有、DB 已软删)
      → 截断至 limit 返回
```

### 多租户与软删除

- 所有业务查询均带 `hospital_id` 与 `deleted_at IS NULL` 条件
- 删除文档为**软删除**（置 `deleted_at`），同时清 Qdrant 向量、删 chunk 行、删磁盘文件

---

## 4. 外部客户端层（`app/clients/`）

2026-08-28 从 `app/services/` 拆出，集中管理所有第三方集成。

| 模块 | 职责 |
|---|---|
| `llm.py` | LLM 封装（通用 OpenAI 兼容客户端）。提供 `get_llm()` / `chat_once()` / `chat_stream()` / `analyze_record()`；部分推理模型强制 `temperature=1.0` 以规避 400 |
| `ai_provider.py` | 运行时路由（读取 `med_ai_provider_configs` 表，`is_active` 单选），抛 `AiProviderInvalid` / `AiProviderNotConfigured` |
| `ai_connections.py` | 面向前端的供应商状态投影，输出 `status`(connected/ready/error)，**永不返回明文凭据** |
| `ima_client.py` | 腾讯 IMA OpenAPI HTTP 客户端（能力详见 §5） |

`app/clients/__init__.py` 统一导出四个模块。

---

## 5. IMA 集成（腾讯 ima.qq.com OpenAPI）

`app/clients/ima_client.py`，`httpx.AsyncClient` 直连 `https://ima.qq.com`，凭证通过请求头 `ima-openapi-clientid` / `ima-openapi-apikey` 传递。超时 30s。

### 已实现的 IMA 能力

| 方法 | IMA 接口 | 说明 |
|---|---|---|
| `list_knowledge_bases()` | `/openapi/wiki/v1/search_knowledge_base` | 搜索知识库；**limit 上限 20**，代码强制 clamp，超限会返回 `code=51` |
| `search_in_knowledge_base()` | `/openapi/wiki/v1/search_knowledge` | 指定库内语义检索 |
| `search_knowledge()` | 组合调用 | 对外主入口，含 AI 断词与多库聚合（见下） |
| `list_knowledge_contents()` | `/openapi/wiki/v1/get_knowledge_list` | 浏览目录；`media_type=99` 为文件夹，其余为文件；返回 `items` + `current_path` 面包屑 |
| `save_note()` | `/openapi/note/v1/import_doc` | 保存 Markdown 笔记；写入前调用 `strip_local_image_refs()` 过滤本地图片引用（防泄露本地路径） |

### AI 断词与多关键词检索（关键实现）

IMA 语义检索对**长句命中率极低**（实测「肺结核治疗指南」直接检索 0 命中），因此 `search_knowledge()` 采用：

```
1. extract_search_keywords(query)   长句 → 1~3 个短关键词
   ├─ 长度 ≤ 6 字：直接返回 [query]（跳过 LLM，低延迟）
   ├─ LLM 提取：调用当前活跃提供商，要求只输出 JSON 字符串数组
   ├─ 规则回退：按标点/连接词("的/与/及/和/或"+"治疗/诊断/指南/方案")切分，保留 ≤8 字片段
   └─ 最终兜底：[query]
        ⚠ 任何异常都不抛，保证检索不中断

2. 候选知识库定位（三级）
   ├─ kb_name 精确匹配
   ├─ 用断词关键词匹配库名
   └─ 空 query 拉取全部库，取前 3 个

3. for kw in keywords: for kb in candidates: 逐个检索
   按 media_id/title 去重，达到 limit 即返回
```

实测（`gpt-5.6-sol`）：

| 查询 | 断词结果 | 命中 |
|---|---|---|
| 肺结核治疗指南 | `['肺结核']` | 4 篇 |
| 儿童肺结核诊断专家共识 | `['儿童肺结核']` | — |
| 糖尿病用药注意事项 | `['糖尿病', '降糖药']` | — |
| 高血压 | `['高血压']` | 0（库内确无相关文档，属正常） |

### IMA 固有限制（实测确认，非代码缺陷）

- 长句检索命中率显著低于短词（已由 AI 断词缓解）
- `highlight_content` 仅在**内容级命中**时返回；PDF 标题级命中时 snippet 为空
- 目录浏览面包屑：根节点 `folder_id` 无 `folder_` 前缀，子节点自带前缀 → 代码在 `list_knowledge_contents()` 中对 `index > 0` 的节点才回填 `media_id`

### 对外 HTTP 接口（`app/routers/knowledge.py`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/knowledge/ima/knowledge-bases` | 列出知识库 |
| GET | `/api/knowledge/ima/search` | 语义检索（走 AI 断词） |
| GET | `/api/knowledge/ima/knowledge-bases/{kb_id}/contents` | 浏览目录，`folder_id` 可空（根目录） |

未配置凭证时返回 `configured=False` + 空列表（**不报错**）；调用失败时返回 `configured=True` + `error` 字段，由前端提示。

---

## 6. 认证与授权

- 登录：`POST /api/auth/login`，校验通过后签发随机 token，写入 MySQL `med_user_sessions` 并缓存到 Redis，TTL = `SESSION_TTL_HOURS`（默认 12h）
- 鉴权：`Authorization: Bearer <token>` → `deps.get_current_user`
  - Redis 命中直接返回；未命中回源 MySQL 并回填 Redis
  - **Redis 不可用直接抛 `RedisUnavailable`（503），不静默降级**
- 角色：`hospital_admin`（医院管理员）可执行服务端配置变更（上传/删除/重建索引/切换 AI 提供商）
- 密码：`app/security.py` 的 `hash_password` / `verify_password`
- 账号锁定：连续失败 5 次锁定 15 分钟

---

## 7. 错误处理约定

所有业务异常继承 `app/exceptions.py` 的 `AppError`，由 `main.py` 的全局处理器统一转为 JSON：

```json
{ "code": "MED_XXX", "message": "...", "detail": "..." }
```

| 异常 | HTTP | code |
|---|---|---|
| `AuthError` | 401 | `MED_AUTH_REQUIRED` |
| `ForbiddenError` | 403 | `MED_FORBIDDEN` |
| `NotFoundError` | 404 | `MED_RESOURCE_NOT_FOUND` |
| `ConflictError` | 409 | `MED_RESOURCE_CONFLICT` |
| `AiProviderInvalid` | 422 | `MED_AI_PROVIDER_INVALID` |
| `UpstreamError` / `ImaApiError` | 502 | `MED_AI_UPSTREAM_UNAVAILABLE` / `MED_IMA_UPSTREAM_ERROR` |
| `AiProviderNotConfigured` / `ImaNotConfigured` / `RedisUnavailable` | 503 | 各自 code |

错误码语义：`MED_AI_PROVIDER_NOT_CONFIGURED`（缺配置，503）与 `MED_AI_UPSTREAM_UNAVAILABLE`（上游故障，502）必须区分，便于运维定位。

---

## 8. 数据模型

| 表 | 模型 | 说明 |
|---|---|---|
| `med_hospitals` | `Hospital` | 医院租户 |
| `med_users` | `RbacUser` | 用户（含锁定、改密、登录审计字段） |
| `med_roles` | `Role` | 角色，含 `data_scope`（self/department/department_tree/hospital） |
| `med_user_roles` | `UserRole` | 用户-角色关联，支持 `expires_at` 授权期限 |
| `med_menu` / `med_role_menu` | `Menu` / `RoleMenu` | 菜单与角色菜单 |
| `med_user_sessions` | `UserSession` | 登录会话 |
| `med_documents` | `Document` | 文档元信息，`status`: parsing/ready/failed |
| `med_document_chunks` | `DocumentChunk` | 分块文本 + `point_id`（指向 Qdrant） |

> 旧 `users` 表已废弃，登录/注册统一走 `med_*` RBAC 表。

索引：`ix_documents_hospital_status`、`ix_documents_hospital_deleted`、`ix_doc_chunks_document`、`ix_doc_chunks_hospital`。

---

## 9. 接口清单

| 方法 | 路径 | 鉴权 | 说明                               |
|---|---|---|------------------------------------|
| GET | `/api/health` | 无 | 健康检查（DB/Redis/AI 提供商状态） |
| POST | `/api/auth/register` | 无 | 注册，默认角色 `doctor`            |
| POST | `/api/auth/login` | 无 | 登录                               |
| POST | `/api/auth/logout` | 登录 | 登出                               |
| GET | `/api/auth/me` | 登录 | 当前用户                           |
| GET | `/api/ai/connections` | 登录 | AI 连接列表（不含凭据）            |
| PATCH | `/api/ai/active-provider` | 管理员 | 切换 AI 提供商                     |
| POST | `/api/chat` | 登录 | 非流式对话                         |
| POST | `/api/chat/stream` | 登录 | 流式对话（SSE）                    |
| POST | `/api/analysis` | 登录 | 病历结构i化分析                    |
| GET | `/api/knowledge/overview` | 登录 | 知识库总览                         |
| GET | `/api/knowledge/documents` | 登录 | 文档列表（分页/筛选）              |
| POST | `/api/knowledge/documents/upload` | 管理员 | 上传并索引                         |
| GET | `/api/knowledge/documents/{id}` | 登录 | 文档详情（含分块）                 |
| DELETE | `/api/knowledge/documents/{id}` | 管理员 | 删除（软删）                       |
| POST | `/api/knowledge/documents/{id}/reindex` | 管理员 | 重建索引                           |
| GET | `/api/knowledge/search` | 登录 | 本地向量语义检索                   |
| GET | `/api/knowledge/ima/*` | 登录 | IMA 集成三接口（见 §5）            |

交互式文档：`http://localhost:8001/docs`

---

## 10. 开发约束（改动前必读）

1. **机械门**：从 `med_work_backend/` 执行，两者都必须通过：
   ```powershell
   .\.venv\Scripts\python.exe -m compileall -q app
   .\.venv\Scripts\python.exe -c "from app.main import create_app; create_app()"
   ```
2. **虚拟环境**：依赖装在 `.venv`，系统 Python 无 `sqlalchemy` 等包，务必用 `.\.venv\Scripts\python.exe`
3. **分层纪律**：新外部 SDK 放 `app/clients/`；新业务逻辑放 `app/services/`；services 不得 import routers
4. **配置**：新增设置项须同步写入 `.env.example`（它是可发现性契约），禁止只在代码注释里说明
5. **响应契约**：改响应字段前须检查前端 `med_work_frontend/src/services/`、`stores/`、`types/` 的调用方
6. **密钥**：只从 settings/环境读取，禁止写入日志、fixtures、示例或 Git
7. **SQL**：一律走 SQLAlchemy 会话与类型化模型，禁止拼接 SQL 字符串
8. **改动 HTTP 端点/后台行为/lifespan/迁移**时，必须实际调用运行中的 API 验证，不能只验证 import
