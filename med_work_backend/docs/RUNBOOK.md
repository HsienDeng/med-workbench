# 运行手册（架构 + 启动 / 运维）

本文档描述两个后端服务的**当前架构**与**实际运行方式**，用于本地开发、联调与部署参考。
架构拆分背景见 `SPLIT_ARCHITECTURE.md`，业务逻辑细节见 `ARCHITECTURE.md`。

---

## 1. 架构总览

```
┌───────────────────┐
│  前端 med_work_frontend (Vite React)                     │
│  http://localhost:8080                                    │
│  vite.config.ts: /api 代理 → http://localhost:8001        │
└───────────────────┬───────────────────────────────────────┘
                    │ /api/*（浏览器同源，无 CORS 问题）
                    ▼
┌───────────────────────────────────────────────────────────┐
│ 服务 A：med_work_backend（FastAPI，对外 8001）              │
│ · 鉴权与会话（JWT + Redis + MySQL）                        │
│ · LangGraph 智能体（agent_service.py）                     │
│ · AI 提供商路由（kimi / o98k，运行时可切换）               │
│ · 知识库接口 → 代理转发到服务 B（rag_proxy.py）             │
└───────┬──────────────────────────┬────────────────────────┘
        │ HTTP 代理（内网）         │ 读写业务表
        ▼                           ▼
┌───────────────────────────┐   ┌──────────────────────────┐
│ 服务 B：med_rag_service   │   │ MySQL 8 (med_workbench)  │
│ （FastAPI，内网 8002）     │──▶│ · med_*   业务表         │
│ · 文档解析 / 切分 / 向量化 │   │ · checkpoint*  会话记忆  │
│ · Qdrant 本地向量库        │   └──────────────────────────┘
│ · bge-base-zh-v1.5 模型   │   ┌──────────────────────────┐
│ · 不做鉴权（hospital_id   │   │ Redis                    │
│   由服务 A 校验后透传）    │──▶│ · 登录会话 token         │
└───────────────────────────┘   │ · AI 提供商路由持久化    │
                                └──────────────────────────┘
```

### 职责边界

| 能力 | 服务 A（8001） | 服务 B（8002） |
|---|---|---|
| 用户鉴权 / 会话 | ✅ 唯一负责 | ❌ 无鉴权 |
| 对外 HTTP 接口 | ✅ 前端只连它 | ❌ 仅内网 |
| AI 对话 / Agent | ✅ LangGraph | ❌ |
| AI 提供商切换 | ✅ | 仅 LLM 语义切分用 |
| 文档解析 / 切分 | ❌ | ✅ |
| 向量化 / 向量检索 | ❌ | ✅ |
| 磁盘写（上传文件） | ❌ | ✅ 唯一持有 |
| MySQL 读写 | 业务表 | `med_documents` / `med_document_chunks` |

### 端口分配

| 组件 | 端口 | 配置文件 |
|---|---|---|
| 前端 | 8080 | `med_work_frontend/vite.config.ts` |
| 服务 A | 8001 | `med_work_backend/.env` → `PORT` |
| 服务 B | 8002 | `med_rag_service/.env` → `PORT` |
| MySQL | 3306 | 两个 `.env` 的 `DB_*` |
| Redis | 6379 | `med_work_backend/.env` 的 `REDIS_*` |

---

## 2. 数据存储

### MySQL（`med_workbench`）

| 表 | 归属 | 说明 |
|---|---|---|
| `med_checkpoints` / `med_checkpoint_blobs` / `med_checkpoint_writes` / `med_checkpoint_migrations` | 服务 A | LangGraph 会话记忆，由 `PrefixedAIOMySQLSaver` 启动时幂等创建 |
| `med_users` / `med_roles` / `med_user_roles` / `med_permissions` / `med_role_permissions` | 服务 A | RBAC |
| `med_hospitals` / `med_departments` | 服务 A | 组织 |
| `med_sessions` | 服务 A | 登录会话 |
| `med_menus` / `med_role_menus` | 服务 A | 动态菜单 |
| `med_documents` / `med_document_chunks` | **服务 B 写**，服务 A 读元数据 | 文档元数据 + 分块文本（向量点 ID） |

### 其他存储

- **向量库**：Qdrant 本地模式，目录 `med_rag_service/data/qdrant`，集合 `medical_knowledge`（768 维，余弦）
- **上传文件**：`med_rag_service/data/uploads/hospital_{id}/`
- **Embedding 模型**：`med_rag_service/models/bge-base-zh-v1.5`（约 400MB，懒加载）
- **Redis**：服务 A 独占（token 缓存、AI 路由、角色缓存）

---

## 3. 前置条件

1. **MySQL 8.0.19+** 已启动（checkpoint 表依赖 `JSON_TABLE`）
2. **Redis** 已启动
3. **Python 依赖**：两个服务**共用** `med_work_backend/.venv`（依赖已装齐，避免重复安装 400MB+）

   如需重建环境：`pip install -r med_work_backend/requirements.txt` + `pip install -r med_rag_service/requirements.txt`
4. **Embedding 模型**：确认 `med_rag_service/models/bge-base-zh-v1.5` 存在；缺失时执行
   `python med_rag_service/scripts/download_embedding_model.py`

---

## 4. 启动与停止

### 启动顺序：先 B 后 A

服务 A 的知识库接口依赖服务 B；B 未启动时 `/api/knowledge/*` 返回 `503 MED_RAG_UNAVAILABLE`（登录与聊天不受影响）。

```powershell
# 终端 1：服务 B（RAG）
cd d:\project\med-workbench\med_rag_service
d:\project\med-workbench\med_work_backend\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8002

# 终端 2：服务 A（对外）
cd d:\project\med-workbench\med_work_backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001

# 终端 3：前端
cd d:\project\med-workbench\med_work_frontend
npm run dev        # http://localhost:8080
```

### 停止

```powershell
# 按监听端口停止（推荐）
(Get-NetTCPConnection -LocalPort 8002 -State Listen).OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
(Get-NetTCPConnection -LocalPort 8001 -State Listen).OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

### 验证

```powershell
curl http://127.0.0.1:8001/api/health   # status/database/redis/ai
curl http://127.0.0.1:8002/health       # status/database/embedding_loaded/vector_db_ready
```

> `embedding_loaded` / `vector_db_ready` 为**懒加载**，服务刚启动时是 `false`，
> 触发一次检索（`/api/knowledge/search`）后变为 `true`，属正常现象。

---

## 5. 接口清单

### 服务 A（`http://127.0.0.1:8001/api`，需 Bearer Token，health 除外）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（DB / Redis / AI 提供商） |
| POST | `/auth/login`、`/auth/register` | 登录 / 注册 |
| GET | `/auth/me`、`/auth/menus` | 当前用户 / 动态菜单 |
| POST | `/auth/logout` | 登出 |
| POST | `/chat`、`/chat/stream` | 对话 / SSE 流式对话 |
| POST | `/analysis` | 智能分析 |
| GET | `/ai/connections` | AI 连接列表 |
| GET | `/knowledge/overview` | 知识库总览（代理 B） |
| GET/POST/DELETE | `/knowledge/documents*` | 文档管理（代理 B） |
| GET | `/knowledge/search` | 语义检索（代理 B） |
| GET | `/knowledge/ima/knowledge-bases` | IMA 知识库列表 |
| GET | `/knowledge/ima/knowledge-bases/{kb_id}/contents` | IMA 目录浏览（文件夹/文件） |
| GET | `/knowledge/ima/search` | IMA 语义检索（带 AI 断词） |
| GET | `/knowledge/ima/media/{media_id}` | IMA 文件详情（取回原文/笔记正文） |
| POST | `/knowledge/ima/notes` | 保存 IMA 笔记（数据出网） |

响应体为 `{token: ...}`（注意不是 `access_token`）；错误统一 `{code, message, detail}`。

### IMA 文件详情的类型支持

| media_type | 类型 | 取正文方式 |
|---|---|---|
| 1 | PDF | 下载原文 → `pypdf` 逐页提取 |
| 11 | 笔记 | `note/get_doc_content` 直接取纯文本 |
| 6 等 | 网页/公众号 | 下载 HTML → 清洗为纯文本 |

- PDF 内部隐藏对象噪声（如 `fmx_OtherMirrors` 水印）已过滤；
- 微信公众号等平台有反爬限制，返回验证页时按「无正文」处理，前端提示去 IMA 客户端查看；
- 正文上限 20000 字，超出截断并在响应中置 `truncated=true`。

### 服务 B（`http://127.0.0.1:8002`，内网，路由前缀 `/internal`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/internal/documents/upload` | 上传 + 解析 + 切分 + 向量化（同步） |
| GET | `/internal/documents` | 文档列表 |
| GET | `/internal/documents/overview` | 总览统计 |
| GET/DELETE | `/internal/documents/{doc_id}` | 详情 / 删除 |
| POST | `/internal/documents/{doc_id}/reindex` | 重建索引 |
| GET | `/internal/search` | 向量检索 |

所有接口需 `hospital_id` 租户参数做数据隔离。

---

## 6. 配置要点

### 两个 `.env` 的关系

两服务是**独立进程**，各自读取自己目录下的 `.env`，无法互相引用。以下 3 类配置必然重复：

| 配置项 | 服务 A | 服务 B | 说明 |
|---|---|---|---|
| `DB_*` | ✅ | ✅ | 共用同一 MySQL 实例，必须两边都有 |
| LLM 密钥 | `O98K_API_KEY` | `LLM_API_KEY` | **同一个密钥**，A 用于对话，B 用于 LLM 语义切分 |
| `UPLOAD_DIR` | ✅（仅参考值，透传） | ✅（实际写盘） | A 不操作磁盘 |

**更换密钥 / 数据库密码时必须两边同步**，两个 `.env` 中已加对应提醒注释。

### 关键配置

| 配置 | 位置 | 默认 | 说明 |
|---|---|---|---|
| `RAG_SERVICE_BASE_URL` | A `.env` | `http://127.0.0.1:8002` | 服务 B 地址 |
| `RAG_SERVICE_TIMEOUT` | A `.env` | `300` | 上传含切分+向量化，需放宽 |
| `AI_PROVIDER` | A `.env` / Redis | `o98k` | Redis 值优先，可在前端切换 |
| `EMBEDDING_MODEL_NAME` | B `.env` | `./models/bge-base-zh-v1.5` | 模型名或本地目录 |
| `QDRANT_PATH` | B `.env` | `./data/qdrant` | 向量库目录 |
| `LLM_CHUNKING` | B `.env` | `true` | LLM 语义切分，失败自动回退规则切分 |

### 忽略规则

两个服务的 `.gitignore` 均已排除 `.env`、`data/`、`models/`、`.venv/`。
**注意**：`models/`、`data/` 使用 `/models/`、`/data/` 锚定根目录，避免误伤 `app/models/` 代码目录（历史踩坑）。

---

## 7. 故障排查

| 现象 | 原因与处理 |
|---|---|
| `/api/knowledge/*` 返回 503 `MED_RAG_UNAVAILABLE` | 服务 B 未启动或 `RAG_SERVICE_BASE_URL` 端口错误；先启动 B |
| 上传文档超时 | 切分 + 向量化为同步执行，调大 `RAG_SERVICE_TIMEOUT`；或设 `LLM_CHUNKING=false` 走规则切分 |
| `embedding_loaded: false` | 懒加载，触发一次检索即可；若报错则检查模型目录是否存在 |
| 上传 PDF 报 500 或状态 `failed`（错误含 `PDF 解析失败` / `cryptography`） | PDF 用了 AES 加密，pypdf 需 `cryptography>=3.1` 解密。执行 `pip install "cryptography>=3.1"` 后重启服务并重建索引 |
| 上传的 docx 状态 `failed`（未从文件中提取到文本内容） | 该 docx 是图片型（如扫描件/截图粘贴），无文字层，属预期行为；需 OCR 或换文本版 |
| 文档卡在 `parsing` 状态 | 后台索引任务被服务重启中断。在列表点「重建索引」即可恢复 |
| IMA 文件详情显示「暂无可在线预览的正文」 | 该平台（如微信公众号）有反爬限制，无法抓取原文，属预期行为，请在 IMA 客户端查看 |
| IMA 接口返回 `configured: false` | 服务 A `.env` 未配置 `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY`；配好后需重启（IMA 未配置时不注册相关 Agent 工具） |
| IMA PDF 正文出现乱码长串 | 检查是否为新增的 PDF 隐藏对象噪声，需在 `_pdf_to_text()` 的 `_PDF_NOISE_RE` 中补充过滤规则 |
| 对话报 `MED_AI_CALL_FAILED` | AI 提供商不可达（如 o98k 需走代理）；切换 `AI_PROVIDER=kimi` 或检查网络 |
| 会话记忆丢失 | 检查 MySQL 中 `med_checkpoints` 等 4 张表；Redis 不可用时会自动降级为内存模式（重启即失忆） |
| MySQL checkpoint 报 collation 冲突 | 将 4 张 checkpoint 表转为 `utf8mb4_0900_ai_ci`：<br>`ALTER TABLE med_checkpoints CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`（4 张表各执行一次） |
| 前端直连后端出现 CORS 错误 | 后端 `CORS_ORIGINS` 仅放行 5173/5174；**推荐走 vite 代理**（8080 同源），不要直连 8001 |
| 端口被占用 | 按第 4 节命令停掉旧进程；避免重复启动同一服务 |

---

## 8. 常用运维操作

```powershell
# 查看两个服务是否在跑
Get-NetTCPConnection -LocalPort 8001, 8002 -State Listen

# 后台启动（无窗口）
Start-Process -FilePath "d:\project\med-workbench\med_work_backend\.venv\Scripts\python.exe" `
  -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8002" `
  -WorkingDirectory "d:\project\med-workbench\med_rag_service" -WindowStyle Hidden

# 冒烟测试服务 B（上传→检索→删除）
cd d:\project\med-workbench\med_rag_service
python test_smoke.py

# 重新下载 embedding 模型
python med_rag_service/scripts/download_embedding_model.py
```

### 默认管理员账号

服务 A 启动时由 `app/services/seed.py` 初始化：
- 账号 `admin`，默认密码 `Admin@123`
- 仅在 `password_hash` 仍是占位符且状态为 `disabled` 时生效（首次初始化）

> **安全提示**：默认密码仅用于本地初始化，生产环境必须立即修改。
