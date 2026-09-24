# med-workbench 业务合并至 my-vben-admin 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 React 项目 `D:\project\med-workbench\med_work_frontend` 的业务页面重写为 Vue3 + Element Plus，合并进 vben（my-vben-admin），菜单/权限体系以 vben 为主，对接 med_work_backend 真实后端。

**Architecture:** vben 保持 frontend 访问模式（本地路由模块定义菜单）；登录/用户/权限码适配 med 后端 `/api/auth/*`；请求层去掉 vben 的 `code===0` 包装约定，改为 med 后端的"HTTP 状态码 + 直接返回 JSON 本体 + `MED_*` 错误码"约定；业务服务层统一基于 `requestClient` 重写到 `src/api/med/`；页面逐模块参照源 React 代码重写为 Vue SFC。

**Tech Stack:** Vue 3.5 + Element Plus 2.x + vben v5.7 workspace 包 + Pinia + Vue Router；SSE 流式对话用原生 fetch + ReadableStream（不走 axios）。

**Spec:** 无独立 spec 文档；事实来源为本计划 + 源仓库代码（`D:\project\med-workbench\med_work_frontend`）+ 后端权限目录（`D:\project\med-workbench\med_work_backend\app\services\permission_service.py` 的 `PERMISSION_CATALOG`）。

## 执行进度

- 2026-09-23：**Phase 0 全部完成**（Task 1-6）——代理切换、request.ts 改造、auth/user/menu API 适配、演示路由清理 + med 路由骨架与占位页、服务层与类型迁移（`src/api/med/*`、`src/types/med/index.ts`）、共享组件（page-head/status-tag/kpi-card）、字典 hook、conversations store。`pnpm typecheck` src/ 无错误；vite dev 编译通过。**注意**：计划中原 Task 5 的类型拆分为多文件方案调整为整体复制源 `types/index.ts` 到 `src/types/med/index.ts`（1232 行纯类型无依赖），PATCH 用 `src/api/med/_utils.ts` 的 `patchRequest`。
- 2026-09-23：**Phase 1 全部完成**（Task 7-10）——提示词管理、患者档案（列表 + 整页详情 + 时间线/分析演变/归档/报告导出）、文档管理、AI 助手会话工作台。`pnpm typecheck` src/ 无错误。
  - Task 10 说明：安装 `markdown-it` + `highlight.js` + `@types/markdown-it` 作为依赖；新增 `src/utils/med/markdown.ts`（归一化中文输出 + 代码高亮 + 新窗口打开链接）、`src/hooks/med/use-chat.ts`（useXChat 状态机的 Vue 版）、`src/components/med/assistant/{composer,welcome-panel,message-item,thinking-panel,citation-list,capability-icons}.vue`；侧栏会话列表为页面内实现（vben 布局无源项目侧栏），支持新建/切换/重命名/删除 + 800ms 防抖整存消息；提示词管理入口复用 `prompt-manage-panel.vue`（el-dialog 内嵌）；模型下拉取 `/ai/connections`（enabled + has_api_key + 有 models），provider 色点轮转。
- 2026-09-23：**Phase 2 全部完成**（Task 11-14）——字典管理（双栏 + 字典项分页 + 批量文本导入）、账号管理（列表筛选 + 新建/编辑抽屉 + 一次性初始密码 + 状态流转 + 重置密码 + 批量导入）、权限管理（角色列表 + 菜单树/权限点树 el-tree 授权 + 系统内置角色只读）、审计日志（只读表格 + 选项化筛选 + 日期范围）。`pnpm typecheck` src/ 无错误。
- 2026-09-23：**Phase 3 完成**（Task 15）——删除 `src/locales/langs/{zh-CN,en-US}/demos.json` 与 `page.json` 中 dashboard 键；README 增加「后端对接（med_work_backend）」章节（启动顺序 / 代理 / 鉴权 / 响应约定 / 页面清单），Mock 章节改为默认关闭说明；`pnpm typecheck` 与 `pnpm build` 均通过。
  - 遗留：`apps/backend-mock` 目录保留（已 `VITE_NITRO_MOCK=false`），是否物理删除由用户决定；真实后端联调（登录→各页面→401 登出→无权限菜单隐藏）待后端可用时执行。

## Global Constraints

- 菜单与权限以 vben 体系为主：本地路由模块（`src/router/routes/modules/`）定义菜单，`meta.authority` 填 med 权限码；不使用 med 后端 `/api/auth/menus`。
- 权限码来源：`GET /api/auth/me` → `UserOut.permissions: string[]`（各角色权限点并集）。同时作为 vben 的 `accessCodes`（按钮级 `v-access:code`）和路由过滤依据。
- 登录：`POST /api/auth/login`，请求体 `{ account, password }`（vben 表单的 `username` 在 API 层映射为 `account`），响应 `{ token, user: UserOut }`，**无 refresh token**。
- 响应约定：med 后端直接返回数据本体，错误用 HTTP 状态码 + `{ code, message }`（`MED_*` 码）。请求层**不得**使用 vben 的 `defaultResponseInterceptor`（code/data 包装）。
- 开发代理：`/api` → `http://localhost:8001`（**无 rewrite**，med 后端路由自带 `/api` 前缀）；关闭 Nitro Mock（`VITE_NITRO_MOCK=false`）。
- 后端权限码（路由 `meta.authority` / 页面内按钮控制）：
  - `/assistant`（AI 会话）：无权限码，登录即可见
  - `/patients` → `patient:view`（按钮：`patient:create` / `patient:update` / `patient:delete` / `patient:import` / `patient:export` / `medical_record:*`）
  - `/documents` → `knowledge:view`（按钮：`knowledge_document:upload` / `knowledge_document:update` / `knowledge_document:delete`）
  - `/prompts`（提示词）：无权限码
  - `/dictionaries` → `dictionary:view`（按钮：`dictionary:manage`）
  - `/accounts` → `organization:user:view`（按钮：`organization:user:manage`）
  - `/permissions` → `organization:role:view`（按钮：`organization:role:manage`）
  - `/audit` → `audit:view`
- 首页 `homePath`：`/assistant`（用户未选工作台总览，会话页为默认落地页）。
- 分页参数约定：查询用 `page` / `page_size`（snake_case 直传后端）。
- 每个任务完成后运行 `pnpm typecheck`（根目录）作为机械门禁。
- 迁移范围与顺序（用户指定）：会话 → 患者档案 → 提示词 → 文档管理 → 字典 → 账号 → 权限 → 审计。执行时按依赖先做简单的 CRUD（Prompts）建立模式，Assistant 最后。

## 源→目标映射总表

| 源（React） | 目标（Vue/vben） |
| --- | --- |
| `src/services/api.ts` 的 `request`/`downloadFile`/错误码映射 | `src/api/request.ts`（改造现有 RequestClient）+ `src/api/med/download.ts` |
| `src/services/{chat,prompts,patients,knowledge,accounts,roles,audit,analysis}.ts` | `src/api/med/{chat,prompts,patients,documents,accounts,roles,audit}.ts` |
| `src/types/index.ts`（~1387 行） | `src/types/med/*.ts`（按模块拆分） |
| `src/stores/conversations.ts` | `src/store/conversations.ts`（Pinia） |
| `src/components/{KpiCard,PageHead,StatusTag,PromptManagePanel}` | `src/components/med/` 同名 Vue 组件 |
| `src/components/PermGate.tsx` | vben 自带 `v-access:code` 指令 / `<AccessControl>` |
| `src/hooks/useDictionaryOptions.ts` + `constants/dictionary.ts` | `src/hooks/use-dictionary-options.ts` + `src/constants/med/dictionary.ts` |
| `src/pages/<Module>/index.tsx` | `src/views/med/<module>/index.vue` |
| antd Table/Form/Modal/Drawer/Descriptions/Upload | el-table + ElForm/el-dialog/el-drawer/el-descriptions/el-upload |

---

## Phase 0：基础设施（对接真实后端）

### Task 1: 环境与代理切换

**Files:**
- Modify: `d:\project\my-vben-admin\.env.development`
- Modify: `d:\project\my-vben-admin\vite.config.ts`

**Interfaces:**
- Produces: dev server `/api` 代理到 `http://localhost:8001`；Nitro Mock 关闭。

- [ ] **Step 1: 修改 `.env.development`**

```env
# 端口号
VITE_PORT=5777

VITE_BASE=/

# 接口地址
VITE_GLOB_API_URL=/api

# 是否开启 Nitro Mock服务，true 为开启，false 为关闭
VITE_NITRO_MOCK=false

# 是否打开 devtools，true 为打开，false 为关闭
VITE_DEVTOOLS=false

# 是否注入全局loading
VITE_INJECT_APP_LOADING=true
```

- [ ] **Step 2: 修改 `vite.config.ts` 代理（去 rewrite，target 改 8001）**

```ts
server: {
  proxy: {
    '/api': {
      changeOrigin: true,
      // med_work_backend (FastAPI)，路由自带 /api 前缀，不做 rewrite
      target: 'http://localhost:8001',
      ws: true,
    },
  },
},
```

- [ ] **Step 3: 验证** — 启动 med 后端后 `pnpm dev`，浏览器访问 `http://localhost:5777/api/auth/me` 应返回 401 JSON（而非 Mock 数据）。
- [ ] **Step 4: Commit** — `git commit -m "chore: switch dev proxy to med_work_backend"`

### Task 2: 请求层改造

**Files:**
- Modify: `d:\project\my-vben-admin\src\api\request.ts`

**Interfaces:**
- Consumes: `@vben/request` 的 `RequestClient`、`errorMessageResponseInterceptor`、`authenticateResponseInterceptor`。
- Produces: `requestClient`（`responseReturn: 'body'`，直接返回数据本体）、`baseRequestClient`；401 统一登出；`MED_*` 错误码中文映射；`formatToken`。

- [ ] **Step 1: 重写 `src/api/request.ts`**（要点）：
  - 移除 `defaultResponseInterceptor({ codeField, dataField, successCode })`（med 后端无 code/data 包装）。
  - `requestClient = createRequestClient(apiURL, { responseReturn: 'body' })`。
  - 移除 refresh token 逻辑：`authenticateResponseInterceptor` 传 `enableRefreshToken: false`，`doRefreshToken` 直接登出（`doReAuthenticate` 不再调用 `refreshTokenApi`）。
  - 移除对 `refreshTokenApi` 的导入（`src/api/core/auth.ts` 中该函数也一并删除）。
  - 错误提示保持 `ElMessage.error`，message 提取逻辑改为：`error.response.data.message ?? error.response.data.detail ?? error.response.data.error`，并按 `MED_*` 错误码映射中文（从源项目 `services/api.ts` 的 `getUserMessage` 移植映射表，含 `MED_CREDENTIALS_INVALID` 等 ~20 条）。
  - 请求头拦截器保留 `Authorization: Bearer` 与 `Accept-Language`。

```ts
// 骨架（完整实现参照源 services/api.ts 的 getUserMessage 映射表）
export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'body',
});
```

- [ ] **Step 2: 验证** — `pnpm typecheck` 通过；dev 下登录接口错误提示为中文（如账号密码错误显示"账号或密码错误"）。
- [ ] **Step 3: Commit** — `git commit -m "refactor(api): adapt request client to med backend conventions"`

### Task 3: 认证与用户信息 API 适配

**Files:**
- Modify: `d:\project\my-vben-admin\src\api\core\auth.ts`
- Modify: `d:\project\my-vben-admin\src\api\core\user.ts`
- Delete: `d:\project\my-vben-admin\src\api\core\menu.ts`（frontend 模式不用后端菜单）及其在 `src/api/index.ts`、`src/router/access.ts` 中的引用（`access.ts` 改为不传 `fetchMenuListAsync` 或保留空实现）

**Interfaces:**
- Produces:
  - `loginApi(params: { password: string; username: string }): Promise<{ accessToken: string; user: MedUserOut }>` — POST `/auth/login`，body `{ account: params.username, password }`。
  - `logoutApi(): Promise<void>` — POST `/auth/logout`（带 Bearer，走 `baseRequestClient`）。
  - `getAccessCodesApi(): Promise<string[]>` — GET `/auth/me` 取 `permissions`。
  - `getUserInfoApi(): Promise<UserInfo>` — GET `/auth/me` 映射：

```ts
// UserOut → UserInfo 映射（roles 填权限码，供路由 meta.authority 过滤）
const userInfo: UserInfo = {
  avatar: '',
  desc: '',
  homePath: '/assistant',
  realName: user.real_name,
  roles: user.permissions, // 关键：路由可见性按权限码过滤
  token: '',
  userId: String(user.id),
  username: user.username,
};
```

- [ ] **Step 1: 重写 `auth.ts`**（删除 `refreshTokenApi`；登录路径 `/auth/login`；`AuthApi.LoginResult = { accessToken: string; user: MedUserOut }`）。
- [ ] **Step 2: 重写 `user.ts`**（`/auth/me` 映射，类型定义放 `src/types/med/user.ts`）。
- [ ] **Step 3: 删除 `menu.ts` 引用**（`src/api/index.ts`、`src/router/access.ts` 中的 `getAllMenusApi`/`fetchMenuListAsync`/ElMessage loading 菜单逻辑）。
- [ ] **Step 4: 验证** — `pnpm typecheck`；dev 下用 `admin / Admin@123` 登录成功，跳转 `/assistant`，顶部显示真实姓名，菜单按权限生成。
- [ ] **Step 5: Commit** — `git commit -m "feat(auth): adapt login/userinfo/access-codes to med backend"`

### Task 4: 清理演示路由，建立 med 路由骨架与占位页

**Files:**
- Delete: `src/router/routes/modules/demos.ts`、`src/router/routes/modules/vben.ts`、`src/router/routes/modules/dashboard.ts`（及对应 `src/views/demos/`、`src/views/dashboard/` 目录）
- Create: `src/router/routes/modules/med.ts`
- Create: `src/views/med/{assistant,patients,documents,prompts,dictionaries,accounts,permissions,audit}/index.vue`（占位：`<template><div>开发中</div></template>`）

**Interfaces:**
- Produces: med 菜单树（三个分组）与 8 条路由，组件懒加载路径 `#/views/med/**`。

```ts
// src/router/routes/modules/med.ts 骨架（title 直接用中文，后续如需 i18n 再抽 key）
const routes: RouteRecordRaw[] = [
  { // 临床工作台
    meta: { icon: 'mdi:robot-outline', order: 100, title: '临床工作台' },
    name: 'MedClinical',
    path: '/clinical',
    children: [
      {
        component: () => import('#/views/med/assistant/index.vue'),
        meta: { title: 'AI 助手' },
        name: 'MedAssistant',
        path: '/assistant',
      },
    ],
  },
  { // 业务管理
    meta: { icon: 'mdi:briefcase-outline', order: 200, title: '业务管理' },
    name: 'MedBusiness',
    path: '/business',
    children: [
      { component: () => import('#/views/med/patients/index.vue'),
        meta: { authority: ['patient:view'], title: '患者档案' },
        name: 'MedPatients', path: '/patients' },
      { component: () => import('#/views/med/documents/index.vue'),
        meta: { authority: ['knowledge:view'], title: '文档管理' },
        name: 'MedDocuments', path: '/documents' },
      { component: () => import('#/views/med/prompts/index.vue'),
        meta: { title: '提示词管理' },
        name: 'MedPrompts', path: '/prompts' },
    ],
  },
  { // 系统管理
    meta: { icon: 'mdi:cog-outline', order: 300, title: '系统管理' },
    name: 'MedSystem',
    path: '/system',
    children: [
      { component: () => import('#/views/med/dictionaries/index.vue'),
        meta: { authority: ['dictionary:view'], title: '字典管理' },
        name: 'MedDictionaries', path: '/dictionaries' },
      { component: () => import('#/views/med/accounts/index.vue'),
        meta: { authority: ['organization:user:view'], title: '账号管理' },
        name: 'MedAccounts', path: '/accounts' },
      { component: () => import('#/views/med/permissions/index.vue'),
        meta: { authority: ['organization:role:view'], title: '权限管理' },
        name: 'MedPermissions', path: '/permissions' },
      { component: () => import('#/views/med/audit/index.vue'),
        meta: { authority: ['audit:view'], title: '审计日志' },
        name: 'MedAudit', path: '/audit' },
    ],
  },
];
export default routes;
```

- [ ] **Step 1: 删除演示模块**（demos/vben/dashboard 路由与视图；注意 `src/locales` 中 demos 相关 key 可暂留）。
- [ ] **Step 2: 创建 `med.ts` 路由 + 8 个占位页**。
- [ ] **Step 3: `src/preferences.ts`** 不必改 `defaultHomePath`（homePath 已由 getUserInfoApi 返回 `/assistant`）。
- [ ] **Step 4: 验证** — `pnpm typecheck`；登录后左侧菜单出现三组菜单；无权限的菜单不显示（可用非 admin 账号验证）。
- [ ] **Step 5: Commit** — `git commit -m "feat(router): add med business route skeleton, remove demo routes"`

### Task 5: 业务类型与服务层迁移

**Files:**
- Create: `src/types/med/user.ts`、`patient.ts`、`document.ts`、`prompt.ts`、`dictionary.ts`、`account.ts`、`role.ts`、`audit.ts`、`chat.ts`（从源 `src/types/index.ts` 摘取对应接口，字段保持 snake_case 原样）
- Create: `src/api/med/chat.ts`、`prompts.ts`、`patients.ts`、`documents.ts`、`dictionaries.ts`、`accounts.ts`、`roles.ts`、`audit.ts`、`download.ts`
- Create: `src/api/med/index.ts`（barrel export）

**Interfaces:**
- Produces（每个文件的函数签名与源一致，仅改走 `requestClient`，路径去掉 `/api` 前缀改用相对路径如 `/patients`，因为 `apiURL=/api` 已含前缀）:
  - `chat.ts`: `listConversations()`, `getConversation(id)`, `createConversation(title?)`, `updateConversation(id, patch)`, `deleteConversation(id)`, `streamChat(messages, opts)`（**streamChat 用原生 fetch + ReadableStream，从源文件 1:1 移植 SSE 解析，token 从 `useAccessStore().accessToken` 取**）
  - `prompts.ts`: `listPrompts()`, `createPrompt(input)`, `updatePrompt(id, input)`, `deletePrompt(id)`
  - `patients.ts`: `getPatients(query)`, `getPatientDetail(id)`, `createPatient`, `updatePatient`, `deletePatient`, `getMedicalRecords(patientId)`, `createMedicalRecord`, `updateMedicalRecord`, `deleteMedicalRecord`, `getPatientTimeline`, `downloadPatientReport`, `getPatientAnalysisEvolution`, `parseMedicalRecordFile`
  - `documents.ts`（源 `knowledge.ts`）: `getKnowledgeOverviewApi()`, `listDocumentsApi(params)`, `uploadDocumentApi(params)`, `getDocumentDetailApi(id)`, `deleteDocumentApi(id)`, `reindexDocumentApi(id)`
  - `dictionaries.ts`（源 `api.ts` 字典部分）: `getDictionaryCategories()`, `getDictionaryOptions(dictCode)`, `getDictionaries(query)`, `createDictionary`, `updateDictionary`, `deleteDictionary`, `getDictionaryItems(dictId, query)`, `createDictionaryItem`, `batchCreateDictionaryItems(dictId, text)`, `updateDictionaryItem`, `deleteDictionaryItem`
  - `accounts.ts`: `getAccounts(query)`, `getAccountOptions()`, `createAccount`, `updateAccount`, `deleteAccount`, `setAccountStatus`, `resetAccountPassword`, `batchImportAccounts(text)`
  - `roles.ts`: `getRoles(query)`, `getRoleMenuTree()`, `getRolePermissionTree()`, `getRole(id)`, `createRole`, `updateRole`, `setRoleStatus`, `deleteRole`
  - `audit.ts`: `getAuditLogs(query)`, `getAuditOptions()`
  - `download.ts`: `downloadFile(path, fallbackName)`（blob 下载 + Content-Disposition 文件名解析，从源 `api.ts` 移植，token 从 accessStore 取）
  - `ai.ts`（会话页需要）: `getAiConnections()`（源 `api.ts`）

- [ ] **Step 1-N: 按模块迁移**。每模块：读源 service 文件 → 类型进 `src/types/med/` → 函数改写为 `requestClient.get/post/put/patch/delete`（注意：med 后端有 PUT/PATCH/DELETE，requestClient 均已支持；query 参数用 `params`）。
- [ ] **Step 2: `streamChat` 移植**（fetch + SSE，不从 requestClient 走；`loadAuth()` 替换为 `useAccessStore().accessToken`）。
- [ ] **Step 3: 验证** — `pnpm typecheck`。
- [ ] **Step 4: Commit** — `git commit -m "feat(api): migrate med business services and types"`

### Task 6: 共享组件、字典 hook 与会话 store

**Files:**
- Create: `src/components/med/page-head.vue`（标题+副标题+右侧操作区 slot）
- Create: `src/components/med/status-tag.vue`（状态→颜色映射通用标签）
- Create: `src/components/med/kpi-card.vue`（统计卡片：label/value/suffix/slot extra）
- Create: `src/constants/med/dictionary.ts`（源 `constants/dictionary.ts` 的字典编码常量与前端兜底数组）
- Create: `src/hooks/use-dictionary-options.ts`（源 `hooks/useDictionaryOptions.ts` 的 Vue 组合式版本：`useDictionaryOptions(dictCode, fallback)` → `{ options, labels, loading }`）
- Create: `src/store/conversations.ts`（源 `stores/conversations.ts` 的 Pinia 版：`conversations/activeKey/initialized/loadFailed/loadConversations/ensureDraft/selectConversation/renameConversation/removeConversation`，保留 loadPromise/draftPromise 防并发）

**Interfaces:**
- Produces: 上述组件/hook/store 的 props 与 API（字段名与源一致，供页面任务消费）。

- [ ] **Step 1: 逐个实现**（参照源文件：`src/components/KpiCard/`、`PageHead/`、`StatusTag/`、`src/hooks/useDictionaryOptions.ts`、`src/stores/conversations.ts`）。
- [ ] **Step 2: 验证** — `pnpm typecheck`。
- [ ] **Step 3: Commit** — `git commit -m "feat(components): add med shared components, dictionary hook and conversations store"`

---

## Phase 1：核心业务页（Vue 重写）

> 每个页面任务的通用要求：
> 1. 先读源 `index.tsx`（及子组件/css），理清数据流再动手。
> 2. antd→Element Plus 映射：`Table`→`el-table`+`el-pagination`；`Form`→`el-form`(rules)；`Modal`→`el-dialog`；`Drawer`(size 数字)→`el-drawer`(size prop)；`Descriptions`→`el-descriptions`；`Select showSearch`→`el-select filterable`；`message`→`ElMessage`；`Popconfirm`→`el-popconfirm`；`Tabs`→`el-tabs`；`Tag`→`el-tag`；`Tooltip`→`el-tooltip`；`Upload.Dragger`→`el-upload drag`。
> 3. 按钮级权限用 vben 的 `v-access:code="['patient:create']"` 指令。
> 4. 完成后 `pnpm typecheck` + dev 手动验证 CRUD 主路径。

### Task 7: 提示词管理（`/prompts`）

**Files:**
- Modify: `src/views/med/prompts/index.vue`（替换占位）
- 参照: 源 `src/pages/Prompts/index.tsx`

**Interfaces:**
- Consumes: `src/api/med/prompts.ts`（Task 5）、`PromptManagePanel` 需求（本页与 Assistant 共用）。
- Produces: 提示词 CRUD 页（列表：预设/自建分组或标记 + 新建/编辑弹窗 + 删除确认）；导出可复用子组件 `src/components/med/prompt-manage-panel.vue`（供 Assistant 提示词切换弹窗复用，props/事件与源 `PromptManagePanel` 对齐）。

- [x] 实现 CRUD 页与共享面板组件；typecheck；验证预设只读、自建可增删改；commit `feat(prompts): migrate prompt management page`。
  - 完成：`src/views/med/prompts/index.vue` + `src/components/med/prompt-manage-panel.vue`（卡片网格 + 详情编辑弹窗 + 删除/复制新建，预设/自建同面板）。`pnpm typecheck` 通过。

### Task 8: 患者档案（`/patients`）

**Files:**
- Modify: `src/views/med/patients/index.vue` + 新增 `patient-detail-view.vue` + 子组件
- 参照: 源 `src/pages/Patients/index.tsx`（含列表、详情抽屉、病历 tab、时间线、AI 解析上传等）

**Interfaces:**
- Consumes: `src/api/med/patients.ts`、`src/api/med/analysis-archive.ts`、`useDictionaryOptions`、`StatusTag`、`downloadFile`。
- Produces: 患者列表（关键词/状态/科室筛选 + 分页 + 勾选批量导出）+ 整页详情（左栏患者信息 + 病历列表；右栏 Tab：病历详情/时间线/分析演变）+ 新建/编辑弹窗 + 病历 CRUD/AI 解析上传/归档 + 报告导出；按钮按 `patient:*` / `medical_record:*` 权限码控制。

- [x] 实现列表+筛选+分页 → 详情整页 → 新建/编辑 → 病历 CRUD/时间线/AI 解析/归档 → 报告导出；typecheck；commit `feat(patients): migrate patient records page`。
  - 完成：`src/views/med/patients/{index,patient-detail-view}.vue`、`src/components/med/{patient-timeline,record-ai-archive-panel,analysis-evolution,report-export-modal}.vue`、`src/api/med/analysis-archive.ts`（归档接口）。`pnpm typecheck` 通过。

### Task 9: 文档管理（`/documents`）

**Files:**
- Modify: `src/views/med/documents/index.vue`
- 参照: 源 `src/pages/Documents/`（11 个文件：index、列表、上传弹窗、详情抽屉、分块预览等）

**Interfaces:**
- Consumes: `src/api/med/documents.ts`、`downloadFile`、`useDictionaryOptions`（doc_type/index_status）。
- Produces: 文档列表（状态/类型/关键词筛选 + 分页）、拖拽上传（el-upload，`.pdf/.docx/.txt/.md`）、详情抽屉（元信息 + 分块列表）、重建索引、删除；按钮按 `knowledge_document:*` 控制。

- [x] 逐块实现；typecheck；commit `feat(documents): migrate knowledge documents page`。
  - 完成：Tabs 切换「概览 / 本地知识库」（源用 antd Menu，本版改 Tabs+内嵌筛选，更紧凑）；KPI 卡片 `kpi-card.vue`、`doc-overview.vue`（含文档构成 + 知识质量看板）、`local-document-table.vue`（关键词/状态/类型筛选 + 分页 + 详情/下载/重新索引/删除/开始索引，存在 parsing 时 3s 轮询）、`local-document-detail-drawer.vue`（元信息 + 分块列表 + 下载按钮）、`upload-document-modal.vue`（拖拽上传 + 元信息）、`upload-tasks-modal.vue`（异步进度视图 + 自动轮询）。`pnpm typecheck` 通过。
  - **本次不迁 IMA 查询 tab**（独立云端集成，UI 与业务依赖较多；后续单独迭代）。

### Task 10: AI 助手会话（`/assistant`）

**Files:**
- Modify: `src/views/med/assistant/index.vue` + 子组件 `composer.vue`（输入区）、`message-item.vue`（消息渲染：thinking 折叠 + markdown + 引用列表）、`welcome.vue`（空态能力卡片）
- Create: `src/utils/med/markdown.ts`（markdown 渲染，选型：`markdown-it` + `highlight.js`，安装为 dependencies）
- 参照: 源 `src/pages/Assistant/index.tsx`（792 行）+ `index.css` + `hooks/useXChat.ts` + `services/chat.ts`

**Interfaces:**
- Consumes: `streamChat`、conversations store（Task 6）、`getAiConnections`、`PromptManagePanel`（Task 7）、`downloadDocumentFile`。
- Produces: 满高会话工作台：
  - 空态：欢迎语 + 4 能力卡片（点击填 prompt）+ 建议问题
  - 消息流：用户/助手气泡；助手消息含 `<details>` 折叠 thinking（生成中自动展开）、markdown 正文、引用卡片（title + score 标签 + 原文下载 + snippet 展开收起）、停止生成标记
  - 输入区：textarea（1-6 行自适应）+ 停止按钮（流式中）+ 三个工具：文件上传（`knowledge_document:upload`）、模型切换（getAiConnections 过滤 enabled，provider 色点）、提示词切换（default + 模板分组 + 管理入口）
  - 多会话：会话列表切换（vben 布局外的页面内侧栏或顶部下拉，**vben 无源项目侧栏会话列表，改为页面内左栏**）、800ms 防抖整存消息、路由 state 联动可简化为页面内状态

- [ ] Step 1: 安装 `markdown-it` + `@types/markdown-it`（+ `highlight.js` 如需代码高亮）。
- [ ] Step 2: 移植 useXChat 状态机为 composable `src/hooks/use-chat.ts`（或直接在页面内实现消息数组管理 + streamChat 回调接线）。
- [ ] Step 3: 实现消息渲染（含 thinking/citations）。
- [ ] Step 4: 实现输入区三工具。
- [ ] Step 5: 接线 conversations store 与防抖保存。
- [ ] Step 6: typecheck + 真实后端联调流式对话/停止/引用下载；commit `feat(assistant): migrate AI chat workbench`。

---

## Phase 2：管理页面

### Task 11: 字典管理（`/dictionaries`）

- Modify: `src/views/med/dictionaries/index.vue`；参照源 `src/pages/Dictionaries/`。
- Consumes: `src/api/med/dictionaries.ts`；双栏：字典列表（分类/状态/关键词筛选）+ 选中字典的字典项管理（分页、批量导入 `编码,显示名[,值]` 文本）；维护操作按 `dictionary:manage` 控制。
- [ ] 实现；typecheck；commit `feat(dictionaries): migrate dictionary management page`。

### Task 12: 账号管理（`/accounts`）

- Modify: `src/views/med/accounts/index.vue`；参照源 `src/pages/Accounts/`。
- Consumes: `src/api/med/accounts.ts`、`getAccountOptions`；列表（关键词/状态/角色/科室筛选）+ 新建（返回一次性初始密码展示）+ 编辑（角色分配）+ 状态流转（启用/停用/锁定/待启用）+ 重置密码 + 批量文本导入 + 删除；按 `organization:user:manage` 控制。
- [ ] 实现；typecheck；commit `feat(accounts): migrate account management page`。

### Task 13: 权限管理（`/permissions`）

- Modify: `src/views/med/permissions/index.vue`；参照源 `src/pages/Permissions/`。
- Consumes: `src/api/med/roles.ts`（getRoles/getRoleMenuTree/getRolePermissionTree/createRole/updateRole/setRoleStatus/deleteRole）；角色列表 + 角色详情（菜单树 el-tree + 权限点树勾选授权）；按 `organization:role:manage` 控制。
- [ ] 实现；typecheck；commit `feat(permissions): migrate role management page`。

### Task 14: 审计日志（`/audit`）

- Modify: `src/views/med/audit/index.vue`；参照源 `src/pages/Audit/`。
- Consumes: `src/api/med/audit.ts`（getAuditLogs/getAuditOptions）；筛选（时间范围/模块/操作人等，选项来自 getAuditOptions）+ 只读表格 + 详情展开；`audit:view`。
- [ ] 实现；typecheck；commit `feat(audit): migrate audit log page`。

---

## Phase 3：收尾

### Task 15: 清理与回归

- [x] 彻底移除 Mock 遗留：`apps/` 目录 + `pnpm-workspace.yaml` 的 `apps/*`；`internal/vite-config` 的 `viteNitroMockPlugin`（插件文件 / 类型 / `nitroMock` 开关 / `VITE_NITRO_MOCK` 读取）与其依赖 `nitropack`、`get-port`（含 workspace catalog 条目）；`scripts/remove-mock.mjs` + 根 `package.json` 的 `remove-mock` + 空 `scripts/` 目录；`docs/mock-api.openapi.json`；`.env.development` 的 `VITE_NITRO_MOCK`。
- [x] `src/locales` 清理 demos 键；`README.md` / `README.en.md` 更新后端对接说明（代理地址、启动顺序、鉴权与响应约定、页面清单、指向 `http://localhost:8001/docs`）。
- [x] `pnpm typecheck`（**全量，含 packages/）0 错误**：修复 4 处 upstream `defineModel` 字面量/泛型推断错误（见下）。
- [ ] 全量回归：登录→会话→患者→文档→提示词→字典→账号→权限→审计；401 过期→重新登录；无权限账号菜单隐藏（**待 med_work_backend 可用后执行**）。
- [x] `pnpm build` 通过。

**全量 typecheck 修复明细（vue-tsc 3.x 下暴露的 upstream 推断问题）：**
- `packages/@core/ui-kit/shadcn-ui/.../collapsible/collapsible.vue`：`defineModel('open', { default: true })` → `defineModel<boolean>('open', { default: true })`（否则 T 被推断为字面量 `true`）。
- `.../expandable-arrow/expandable-arrow.vue`：`defineModel({ default: false })` → `defineModel<boolean>({ default: false })`。
- `.../collapsible/collapsible-params.vue`：`defineModel('value', { default: {} as ... })` → 显式泛型 + 工厂 `default: () => ({})`。
- `packages/effects/layouts/.../preferences/blocks/layout/sidebar.vue`：`defineModel<string[]>(..., { default: [] })` → `{ default: () => [] }`（数组 default 需工厂函数）。

## Self-Review 结论

- 范围覆盖：用户指定的 8 个模块均有对应任务（7-14）；菜单/权限以 vben 为主（Task 3/4）；对接真实后端（Task 1-3）。工作台总览（Dashboard）与分析页（Analysis）不在用户指定范围，未列入。
- 类型一致性：`UserInfo.roles = permissions` 的映射是路由过滤的关键约定，Task 3 定义、Task 4 消费；`requestClient responseReturn: 'body'` 由 Task 2 定义、Task 5 全部服务消费。
- 已知风险：① vben `RequestClient` 的 `responseReturn: 'body'` 语义需在 Task 2 实测（若该选项不适用则去掉响应拦截器后直接返回 response.data）；② med 登录无 refresh token，登录过期弹窗模式（loginExpired modal）不可用，统一走 logout；③ Assistant 页面的侧栏会话列表需在 vben 布局内自行实现。
