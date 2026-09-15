# AI 助手增强设计(Session / RAG / 多模型 / 工具调用)

- 日期:2026-08-27
- 状态:待审查
- 范围:后端 `med_work_backend` + 前端 `med_work_frontend` 的 Assistant 页面

## 1. 背景与目标

当前前端 Assistant 页面已对接后端 `/api/chat/stream`(SSE 流式),链路可用,但存在四方面能力缺口:

1. **会话无持久化**:会话与聊天记录只存前端内存(`useXChat` + `storeRef`),刷新即丢,换设备不可恢复。
2. **无知识库引用**:助手回答无法引用当前医院已入库的文档(知识库管线已存在,仅未被对话链路使用)。
3. **多模型选择粒度粗**:只有管理员在"API 连接"页全局切换供应商(Redis 持久化),普通用户无法按自己习惯选模型。
4. **无工具调用**:AI 只能纯文本回答,不能自主调用知识库检索、病历分析等能力。

本次目标:在现有单聊链路上做增强,一次性补齐上述四项,并保持对现有 `/api/chat`(非流式)与 `/api/analysis` 的兼容。

## 2. 现状与可复用资产

| 资产 | 位置 | 复用方式 |
|---|---|---|
| 供应商抽象 `get_llm(provider=, model=)` | `app/services/kimi.py` | 直接支持按 provider+model 路由,多模型基础已具备 |
| 激活供应商路由 `get_active_provider` | `app/services/ai_provider.py` | 作为模型选择第 3 级回退 |
| 知识库语义检索 `search_knowledge(db, hospital_id, query, limit)` | `app/services/document_service.py` | 工具与 kb_mode 直接调用,天然按医院隔离 |
| 病历分析 `analyze_record(text, analysis_type, provider)` | `app/services/kimi.py` | 工具化,复用 4 种分析类型 |
| 会话/消息的租户隔离范式 | `app/models/*`(`hospital_id` + 软删) | 新表沿用 |
| 前端流式客户端 `streamChat` | `src/services/chat.ts` | 需升级 SSE 解析,保持签名 |

## 3. 范围

### 本轮做

- 后端会话/消息/用户偏好三张新表 + 迁移 SQL。
- 会话 CRUD 与消息回填接口。
- `/api/chat/stream` 扩展:会话绑定、知识库开关、工具调用、按会话模型。
- 内置工具集(最小集):知识库检索 + 病历分析(4 种类型)。
- 外部集成 IMA(腾讯 ima.qq.com):`ima_search` 检索 IMA 知识库、`ima_save_note` 保存笔记到 IMA,作为内置工具纳入工具集(需管理员配置第三方凭证;涉及数据出网,见 §9)。
- 用户默认模型偏好(读写),与管理员全局切换并存。
- 前端 Assistant 页面配套改造。

### 本轮不做(非目标)

- 不引入独立 Agent 服务/新进程。
- 不做流式过程中的工具中间结果流式输出(工具阶段非流式,最终文本流式)。
- 不做会话分享/协作、消息编辑、AI 自动标题。
- 不做 `tools` 自定义注册 API(工具清单由后端维护)。
- 不改造 `/api/analysis` 与 `/api/chat`(非流式)的既有契约。

## 4. 架构总览

沿用方案 A(扩展单聊接口 + 后端托管会话),保持 `/api/chat/stream` 为对话唯一入口:

```
前端 Assistant
  ├─ POST /api/chat/stream                       对话(增强)
  ├─ GET  /api/chat/conversations                会话列表
  ├─ POST /api/chat/conversations                新建会话
  ├─ PUT  /api/chat/conversations/{id}           重命名/更新会话属性
  ├─ GET  /api/chat/conversations/{id}/messages  历史回填
  ├─ DELETE /api/chat/conversations/{id}         删除会话(软删)
  └─ GET/PUT /api/chat/preferences               用户默认模型
        ▼
app/routers/chat.py(扩展现有路由 + 新增会话端点)
        ▼
app/services/chat_service.py(新增:会话托管 + 工具执行循环 + RAG 组装)
  ├─ app/services/document_service.search_knowledge   (复用,按医院隔离)
  ├─ app/services/kimi.get_llm / analyze_record       (复用,支持指定 provider+model)
  ├─ app/services/ima_client.py                       (新增:IMA OpenAPI HTTP 客户端,凭证未配置时无副作用)
  └─ app/models/conversation.py                        (新增 ORM)
```

新增文件:`app/models/conversation.py`、`app/services/chat_service.py`、`app/services/ima_client.py`、`sql/003_conversations.sql`、`docs/superpowers/specs/2026-08-27-ai-assistant-enhancement-design.md`(本文档)。

改动文件:后端 `app/schemas/chat.py`、`app/routers/chat.py`、`app/models/__init__.py`、`app/services/kimi.py`(少量,见 7.3);前端 `src/services/chat.ts`、`src/pages/Assistant/index.tsx`、`src/types/`。

## 5. 数据模型

遵循现有范式:`med_` 前缀、`hospital_id` 租户隔离、`BigInteger` 主键、`created_at/updated_at/deleted_at`、软删。迁移写入 `sql/003_conversations.sql`。

### 5.1 `med_conversations` 会话表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK AUTO_INCREMENT | |
| hospital_id | BIGINT NOT NULL | 租户隔离 |
| user_id | BIGINT NOT NULL | 归属用户 |
| title | VARCHAR(255) NOT NULL | 首条用户消息截断 30 字 |
| model_provider | VARCHAR(32) NOT NULL | 会话模型供应商(kimi/opencode/o98k) |
| model_name | VARCHAR(64) NOT NULL | 会话模型名 |
| kb_mode | TINYINT NOT NULL DEFAULT 0 | 会话级知识库开关,0/1 |
| status | VARCHAR(20) NOT NULL DEFAULT 'active' | active/deleted |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | |
| deleted_at | DATETIME NULL | 软删除 |

索引:`(hospital_id, user_id, deleted_at)`。

### 5.2 `med_conversation_messages` 消息表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK AUTO_INCREMENT | |
| hospital_id | BIGINT NOT NULL | 租户隔离 |
| conversation_id | BIGINT NOT NULL FK → med_conversations.id ON DELETE CASCADE | |
| role | VARCHAR(16) NOT NULL | user / assistant / tool |
| content | TEXT NOT NULL | 文本;tool 消息存工具结果 JSON |
| citations | JSON NULL | 引用来源 `[{"document_id", "title", "chunk_index", "snippet"}]` |
| tool_calls | JSON NULL | 工具调用痕迹 `[{"tool", "args", "result_summary"}]` |
| model_provider | VARCHAR(32) NULL | 该条 assistant 消息所用供应商 |
| model_name | VARCHAR(64) NULL | 该条 assistant 消息所用模型 |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

索引:`(conversation_id, id)`。`tool` 角色的消息仅用于记录工具执行结果,回填时不直接展示给用户。

### 5.3 `med_user_ai_prefs` 用户默认模型偏好表

独立小表,避免改动 RBAC 的 `med_users`。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK AUTO_INCREMENT | |
| hospital_id | BIGINT NOT NULL | 租户隔离 |
| user_id | BIGINT NOT NULL | |
| provider | VARCHAR(32) NOT NULL | 用户默认供应商 |
| model | VARCHAR(64) NOT NULL | 用户默认模型 |
| updated_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | |

唯一约束:`(hospital_id, user_id)`。

### 5.4 模型选择解析规则(3 级回退)

1. 请求显式传 `model_provider` + `model_name`(会话创建或更新时指定)→ 优先。
2. 否则查 `med_user_ai_prefs` 用户偏好 → 使用。
3. 否则回退系统激活供应商 `get_active_provider(settings)`。
4. 校验:指定 provider 必须存在且已配置 API Key;不满足则回退第 3 级,并在 SSE `meta` 事件中提示实际使用的模型。

会话创建时解析一次并固化到 `med_conversations.model_provider/model_name`;会话内消息使用会话固定模型,避免中途漂移。

### 5.5 IMA 外部集成凭证(新增 `.env` 项)

| 变量 | 说明 |
|---|---|
| `IMA_OPENAPI_CLIENTID` | IMA OpenAPI Client ID(在 https://ima.qq.com 的 agent-interface 页面获取),空值表示未开通 |
| `IMA_OPENAPI_APIKEY` | IMA OpenAPI API Key,空值表示未开通 |

`app/config.py` 的 `Settings` 增加 `ima_openapi_clientid: SecretStr`、`ima_openapi_apikey: SecretStr` 及 `ima_configured` 属性;凭证同步进 `.env.example` 并注明"管理员配置后,AI 助手将自动启用 IMA 检索与笔记保存工具"。凭证视为管理员对医疗数据出网的显式授权(见 §9)。

## 6. 接口契约

### 6.1 会话 CRUD

**`GET /api/chat/conversations`**(需登录)
返回当前用户(当前医院)会话列表,按 `updated_at DESC`,软删排除。
```json
[{"id": 1, "title": "高血压用药咨询", "model_provider": "kimi", "model_name": "kimi-k3", "kb_mode": true, "created_at": "...", "updated_at": "..."}]
```

**`POST /api/chat/conversations`**(需登录)
```json
{"title": "新对话", "model_provider": null, "model_name": null, "kb_mode": false}
```
- `model_provider/model_name` 为空则按 5.4 解析并固化。
- 返回创建后的会话对象(201)。

**`PUT /api/chat/conversations/{id}`**(需登录)
```json
{"title": "可选新标题", "kb_mode": true}
```
仅允许修改本人会话;修改 `kb_mode` 后后续请求生效。

**`GET /api/chat/conversations/{id}/messages`**(需登录)
返回该会话消息列表(不含 `tool` 角色消息,但保留 `citations`/`tool_calls` 挂载在 assistant 消息上),按 `id ASC`:
```json
{"items": [{"id": 1, "role": "user", "content": "...", "created_at": "..."},
           {"id": 2, "role": "assistant", "content": "...", "citations": [...], "tool_calls": [...], "model_name": "kimi-k3", "created_at": "..."}]}
```

**`DELETE /api/chat/conversations/{id}`**(需登录)
软删(置 `deleted_at`),204。仅限本人会话。

### 6.2 用户默认模型偏好

**`GET /api/chat/preferences`**(需登录)
```json
{"provider": "kimi", "model": "kimi-k3"}
```
未设置时返回当前系统激活供应商与模型。

**`PUT /api/chat/preferences`**(需登录)
```json
{"provider": "opencode", "model": "opencode-med"}
```
校验 provider 存在且已配置 API Key、model 非空,否则 422 提示。保存后新会话生效,已有会话不受影响。

### 6.3 `POST /api/chat/stream`(增强,需登录)

请求体扩展(全部新字段可选,保证旧客户端兼容):

```json
{
  "conversation_id": 1,
  "messages": [{"role": "user", "content": "帮我总结高血压指南的要点"}],
  "system_prompt": null,
  "temperature": 0.3,
  "model_provider": null,
  "model_name": null,
  "kb_mode": null,
  "tools": true
}
```

语义规则:

- **`conversation_id`**:绑定会话。后端以该会话库中历史消息为上下文,`messages` 中仅取**最后一条 user 消息**作为新增输入并落库。会话不存在或不属于当前用户 → 404/403。
- **无 `conversation_id`**:退化为无持久化纯对话(与现状行为一致),保证旧客户端不受影响。
- **`kb_mode`**:`null` 表示沿用会话已存值;`true/false` 覆盖本次请求(并回写会话)。无会话时按本次值执行。
- **`tools`**:默认 `true`。`false` 时禁用工具调用(纯对话)。
- **`model_provider/model_name`**:按 5.4 解析。

### 6.4 SSE 事件协议(向后兼容)

现有文本流格式保持不变:每个增量片段一行 `data: <文本>`,结束 `data: [DONE]`,错误 `data: [ERROR] <信息>`。新增结构化事件以 JSON 行形式下发,前端通过 `data:` 后是否以 `{` 开头区分:

| 事件 | 格式 | 说明 |
|---|---|---|
| text(不变) | `data: 片段` | 流式文本增量 |
| tool-start | `data: {"type":"tool-start","name":"knowledge_search","args":{...}}` | 工具开始执行 |
| tool-result | `data: {"type":"tool-result","name":"knowledge_search","summary":"命中 3 条"}` | 工具执行完成(仅摘要,不推全文) |
| citations | `data: {"type":"citations","items":[{"source":"local","document_id":1,"title":"...","chunk_index":2,"snippet":"..."}]}` | 回答引用来源,`source` 为 `local`(院内知识库)或 `ima`(IMA 检索,含 `title`/`snippet`/可空 `url`),assistant 文本完成后推一次 |
| meta | `data: {"type":"meta","model_provider":"kimi","model_name":"kimi-k3","usage":{...}}` | 模型与用量信息 |
| done | `data: [DONE]` | 结束(不变) |
| error | `data: [ERROR] <信息>` | 错误(不变) |

前端解析升级见 10.2。旧客户端忽略 JSON 行会导致文本拼接污染,因此**前端与服务端需同版本升级**;后端在 `tools=true` 且有结构化事件时,纯文本行仍为可读文本,旧客户端仅丢失引用/工具痕迹,不产生错误。

## 7. 工具调用设计

### 7.1 内置工具清单(最小集)

工具 Schema 以 OpenAI function calling JSON Schema 定义,由后端维护(不开放自定义注册):

**`knowledge_search`** — 检索当前医院知识库
```json
{"name": "knowledge_search",
 "description": "在院内知识库中做语义检索,返回与问题相关的文档片段。用于回答涉及指南、文献、药品说明书、院内规范的问题。",
 "parameters": {"type": "object",
   "properties": {"query": {"type": "string", "description": "检索关键词或问题"}, "limit": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5}},
   "required": ["query"]}}
```
实现:`document_service.search_knowledge(db, hospital_id=当前医院, query=query, limit=limit)`,结果压缩为 `[{"document_id", "title", "content", "score"}]` 传给模型。

**`medical_record_analysis`** — 病历智能分析(复用现有 `analyze_record`)
```json
{"name": "medical_record_analysis",
 "description": "对病历文本进行结构化分析,类型包括:record 结构化整理、medication 用药审核、risk 风险评估、exam 检查解读。",
 "parameters": {"type": "object",
   "properties": {"text": {"type": "string", "description": "病历原文"}, "analysis_type": {"type": "string", "enum": ["record", "medication", "risk", "exam"], "default": "record"}},
   "required": ["text"]}}
```
实现:调用 `kimi.analyze_record(text, analysis_type, provider=会话模型供应商)`,结果 JSON 传给模型。

**`ima_search`** — 检索 IMA 知识库(外部,需配置凭证)
```json
{"name": "ima_search",
 "description": "在外部 IMA 知识库中按语义检索与问题相关的条目。用于回答涉及 IMA 中已有资料的问题。仅当配置了 IMA 凭证时可用,否则向用户说明该能力未开通。",
 "parameters": {"type": "object",
   "properties": {"query": {"type": "string", "description": "检索关键词或问题"}, "knowledge_base_name": {"type": "string", "description": "限定检索的知识库名称;省略时检索用户全部 IMA 知识库(最多前 3 个)"}, "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5}},
   "required": ["query"]}}
```
实现:调用 IMA OpenAPI `openapi/wiki/v1`(`search_knowledge_base` → `search_knowledge`),结果压缩为 `[{"knowledge_base": "...", "title", "snippet", "url"}]` 传给模型,并产出 `citations`(见 §6.4,`source="ima"`)。详见 §7.5。

**`ima_save_note`** — 把内容保存为 IMA 笔记(外部,需配置凭证)
```json
{"name": "ima_save_note",
 "description": "将回答或整理好的文本保存为用户 IMA 笔记。仅在用户明确要求'保存/记到笔记'时调用,不得主动调用。",
 "parameters": {"type": "object",
   "properties": {"title": {"type": "string", "description": "笔记标题"}, "content": {"type": "string", "description": "Markdown 笔记正文,不得包含本地图片引用"}},
   "required": ["title", "content"]}}
```
实现:调用 IMA OpenAPI `openapi/note/v1/import_doc`(`content_format=1`),返回 `note_id` 传给模型。内容写入前过滤本地图片引用;医疗内容出网需凭证已配置且由用户显式触发(见 §7.5、§9)。

### 7.2 与 `kb_mode` 的关系

- **`kb_mode=true`(显式 RAG)**:后端在请求前先执行 `knowledge_search`,把命中片段作为系统上下文注入 prompt,回答附带 `citations`。这是兜底、确定性的检索。
- **`tools=true`(自主工具)**:AI 自行决定何时调用内置工具(`knowledge_search` / `medical_record_analysis` / IMA 工具),通过工具执行循环完成。
- 两者可同时开启:显式 RAG 保证基础引用,工具调用补充按需深度检索与分析。`kb_mode=false` 且 `tools=false` 时为纯对话。

### 7.3 工具执行循环

在 `chat_service.py` 中实现:

1. `llm = kimi.get_llm(temperature=req.temperature, provider=会话provider, model=会话model)`,若 `tools` 开启则 `llm = llm.bind_tools(内置工具清单)`,清单 = `knowledge_search` + `medical_record_analysis`,**仅当 IMA 凭证已配置时**追加 `ima_search`、`ima_save_note`(见 §7.5)。
2. 循环(最多 3 轮):
   - `resp = await llm.ainvoke(messages)`(非流式,工具协商阶段不流式)。
   - 若 `resp.tool_calls` 非空:对每个调用执行对应工具,产出 `ToolMessage(content=结果JSON, tool_call_id=...)`,推 `tool-start`/`tool-result` SSE 事件,追加后继续循环。
   - 若工具执行抛出异常:把 `{"error": "..."}` 作为工具结果返回给模型,不中断链路,由模型决定如何向用户说明。
   - 无 `tool_calls` 时进入第 3 步。
3. 最终文本阶段:`async for chunk in llm.astream(messages)` 流式输出文本(`data: 片段`)。
4. 结束后:推 `citations` 事件(若本轮检索过)与 `meta` 事件,落库 assistant 消息(含 `citations`、`tool_calls`、模型信息)。

`kimi.py` 需小幅增强:暴露 `bind_tools` 支持(在 `get_llm` 返回的实例上调用,无需改函数签名)与 `ToolMessage` 转换辅助,不改变既有函数行为。

### 7.4 上下文窗口管理

- 组装上下文时取会话最近 **20 条**消息(含 user/assistant,排除 tool),单条超过 2000 字截断。
- system prompt(医疗声明)与 kb_mode 注入的检索片段优先保留。
- 超限策略在 `chat_service.py` 内实现,不暴露给前端。

### 7.5 IMA 外部集成(笔记 + 知识库)

#### 7.5.1 集成方式

后端直接以 **HTTP 客户端**方式调用 IMA OpenAPI(`https://ima.qq.com`),**不依赖 Node 运行时、不读取 SKILL.md**——SKILL.md 中的接口决策表已翻译为 Python 方法。

新增 `app/services/ima_client.py`,职责:

- 统一 POST + JSON,携带凭证头 `ima-openapi-clientid` / `ima-openapi-apikey`;解析统一响应 `{"code":0,"msg":"...","data":{...}}`,`code≠0` 抛 `ImaApiError(msg)`。
- 凭证从 settings 读取(`IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY`,见 §5.5),**绝不落日志、绝不进响应**。
- 提供方法:
  - `async search_knowledge(query, kb_name=None, limit=5)`:按名称定位知识库(`search_knowledge_base`,缺省取前 3 个)→ 逐个 `search_knowledge`,合并排序取 top。
  - `async save_note(title, content)`:调用 `openapi/note/v1/import_doc`(`content_format=1`),写入前过滤本地图片引用(`![](file://...)` / `![](C:\...)` 等)。
- `configured` 属性:凭证均已配置时返回 True,用于决定工具是否注册。

#### 7.5.2 凭证与配置(新增 `.env` 项,同步 `.env.example`)

| 变量 | 说明 |
|---|---|
| `IMA_OPENAPI_CLIENTID` | IMA OpenAPI Client ID(https://ima.qq.com/agent-interface 获取),空值表示未开通 |
| `IMA_OPENAPI_APIKEY` | IMA OpenAPI API Key,空值表示未开通 |

`app/config.py` 的 `Settings` 增加 `ima_openapi_clientid: SecretStr`、`ima_openapi_apikey: SecretStr`,并提供 `ima_configured` 属性。

#### 7.5.3 工具注册与调用边界

- **凭证未配置** → `ima_search` / `ima_save_note` 不注册进工具清单,AI 不会调用;若用户显式询问,回答说明"IMA 集成未开通"。
- **凭证已配置** → 两个工具注册;`ima_save_note` 的 system prompt 约束"仅在用户明确要求保存/记到笔记时调用,不得主动保存"。
- 工具执行失败(凭证失效、限流、网络)→ 按 §7.3 将 `{"error": ...}` 返回给模型,不中断链路,不泄露密钥。

#### 7.5.4 引用与合规

- `ima_search` 命中的条目以 `source="ima"` 的 citation 呈现(`title`/`snippet`,可空 `url`)。
- **数据出网**:笔记写入与知识库检索会把内容发往 `ima.qq.com`,属于医疗数据出网。必须同时满足:①管理员已配置凭证(视为开通授权);②`ima_save_note` 由用户显式指令触发;③涉及患者信息的文本默认拒绝保存(见 §9)。
- 文件上传(COS 流程)、`import_urls` 本轮**不实现**(非工具集范围,后续扩展)。

## 8. 错误处理

| 场景 | 行为 |
|---|---|
| 供应商未配置 API Key | 503,`MED_AI_NOT_CONFIGURED`(沿用现有) |
| 会话不存在/属于他人 | 404 / 403 |
| `messages` 为空且会话无历史 | 400,`MED_CHAT_EMPTY` |
| 工具执行异常 | 作为工具结果返回模型,不中断;日志记录(不含敏感内容) |
| 模型输出非法(如病历分析 JSON 解析失败) | 与现有 `/api/analysis` 一致抛 `MED_ANALYSIS_FAILED` 类错误 |
| 偏好 provider 未配置 | 422,提示可选供应商 |
| IMA 凭证未配置 / 失效 / 限流 | `ima_search`/`ima_save_note` 执行失败按 §7.3 返回 `{"error":...}` 给模型,由模型说明;凭证未配置时工具不注册,不产生调用 |

错误信息与诊断按 AGENTS.md 要求,区分:缺配置 / 网络失败 / 供应商拒绝 / 响应畸形,日志可定位但**不得输出消息内容与密钥**。

## 9. 安全与合规

- 会话消息内容属于临床业务数据,沿用现有数据库安全规范存储;日志、异常信息、工具结果摘要均不得包含病历全文与患者标识。
- 系统提示词保留医疗免责声明(现有 `DEFAULT_SYSTEM_PROMPT` 基础上扩展):涉及诊疗建议须声明"仅供参考,需经临床医生审核";引用知识库内容时标注来源。
- 接口全部要求登录鉴权(`get_current_user`),会话/偏好按 `hospital_id + user_id` 隔离,禁止跨租户访问。
- `PUT/PATCH` 类写接口沿用现有权限粒度(普通登录用户可管理自己会话;不新增管理员专属接口)。
- **IMA 数据出网**:`ima_save_note`/`ima_search` 会把内容发往 `ima.qq.com`。前置条件:管理员已配置凭证(视为开通授权);`ima_save_note` 仅由用户显式指令触发;AI 在保存前对患者标识(PHI)做检测,含可识别患者信息的文本拒绝保存并提示(客户端侧需确认该文本无敏感内容)。IMA 凭证属第三方密钥,遵循 settings/env 读取,不落日志、不进异常信息。
- **工具权限**:`ima_save_note` 属于"用户显式授权才执行"类工具,在 system prompt 中声明"仅当用户明确要求保存/记到笔记时才调用,绝不主动保存"。

## 10. 前端改动

### 10.1 新增 API 封装(`src/services/chat.ts`)

- 保留 `streamChat` 签名,内部升级 SSE 解析:分派 `text / tool-start / tool-result / citations / meta / [DONE] / [ERROR]` 到回调。
- 新增 `listConversations`、`createConversation`、`updateConversation`、`deleteConversation`、`listConversationMessages`、`getPreferences`、`updatePreferences`。

### 10.2 `Assistant/index.tsx` 改造

- 会话列表改为后端数据:进入页面拉取 `listConversations`;新建/删除/重命名调用对应 API;切换会话拉取消息历史。
- 输入区新增"知识库模式"开关(默认取会话 `kb_mode`)。
- 顶部或会话菜单内提供模型选择(下拉,选项来自 `/api/ai/connections` 的可用模型),保存到会话与用户偏好。
- 引用来源渲染:assistant 气泡下方折叠展示 `citations`(文档标题 + 片段);工具调用痕迹以轻量标签展示(如"已检索知识库 ×3")。
- 移除 `storeRef` 内存会话逻辑,统一走后端。

### 10.3 类型声明

更新 `src/types/` 中会话、消息、偏好、SSE 事件类型。

## 11. 测试与验证

按 AGENTS.md Mechanical Gate,完成前必须运行:

```powershell
.\.venv\Scripts\python.exe -m compileall -q app
.\.venv\Scripts\python.exe -c "from app.main import create_app; create_app()"
```

接口级验证(启动 `uvicorn app.main:app --port 8001` 后逐项执行并记录):

1. 登录获取 token;`POST /api/chat/conversations` 建会话,校验 5.4 模型回退。
2. `POST /api/chat/stream`(带 `conversation_id`):无知识库开关时纯对话,验证消息落库。
3. `kb_mode=true`:验证回答引用当前医院知识库、SSE `citations` 事件、assistant 消息含 citations。
4. `tools=true`:构造"总结高血压指南要点"类问题,验证 `knowledge_search` 工具被调用、`tool-start/tool-result` 事件、回答含引用;构造病历文本验证 `medical_record_analysis`。
5. IMA 集成:①未配置凭证时,工具清单不含 ima 工具,AI 不会调用;②配置凭证后(测试环境用假 token 指向 stub 服务),`ima_search` 被调用、citations 含 `source="ima"`;`ima_save_note` 仅在用户显式要求时触发,含患者标识文本被拒绝保存;③凭证失效返回 `{"error":...}` 给模型而非中断链路。
6. `GET /api/chat/conversations`、`GET .../messages` 回填一致;`DELETE` 软删后列表不含。
7. `GET/PUT /api/chat/preferences` 读写与校验(未配置 provider 拒绝)。
8. 供应商回归:缺 key 路径返回 503;旧客户端(无新字段)仍可正常对话。
9. 跨租户隔离:医院 A 用户不能读取医院 B 会话。

## 12. 实施顺序

1. `sql/003_conversations.sql` + ORM 模型 + 迁移应用。
2. `app/services/chat_service.py`(会话托管 + RAG 组装 + 工具循环)+ `kimi.py` 小增强。
3. `app/services/ima_client.py` + settings(`IMA_OPENAPI_*`)+ `.env.example`,凭证未配置时工具自动不注册。
4. `app/schemas/chat.py` 与 `app/routers/chat.py`(新端点 + stream 扩展 + SSE 事件)。
5. 接口级验证(第 11 节),修复问题。
6. 前端 `services/chat.ts` 升级 + `Assistant` 页面改造 + 类型更新。
7. 前后端联调,回归 `Analysis`/`ApiConnections` 页面不受影响。
