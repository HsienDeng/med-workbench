# my-vben-admin

> 由 [create-vben-admin](https://github.com/379949990/create-vben-admin) 从 [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin) 提取生成的独立前端工程。

[English README](./README.en.md)

## 概览

| 项                | 值                                      |
| ----------------- | --------------------------------------- |
| UI 模板           | `web-ele`（Element Plus） |
| upstream ref      | `v5.7.0`                               |
| create-vben-admin | `1.0.1`            |

本仓库采用 **扁平布局**：业务代码在仓库根目录；构建所需的 upstream workspace 包保留在 `packages/` 与 `internal/` 中，一般无需修改。

## 快速开始

```bash
pnpm install   # 若生成时已完成可跳过
pnpm dev
```

开发服务器端口由根目录 `.env.development` 中的 `VITE_PORT` 控制（当前为 **5777**）。请以终端实际输出为准。

## 常用命令

| 命令             | 说明                |
| ---------------- | ------------------- |
| `pnpm dev`       | 开发模式            |
| `pnpm build`     | 生产构建            |
| `pnpm preview`   | 预览构建产物        |
| `pnpm typecheck` | TypeScript 类型检查 |

## 后端对接（med_work_backend）

本工程已对接真实后端 **med_work_backend**（FastAPI），仓库内的 Nitro Mock 服务已彻底移除。

### 启动顺序

1. 先启动后端：`http://localhost:8001`（路由自带 `/api` 前缀）
2. 再启动前端：`pnpm dev`（端口 **5777**）

### 代理与接口约定

| 项           | 值                                                                   |
| ------------ | -------------------------------------------------------------------- |
| 代理         | `/api` → `http://localhost:8001`（**无 rewrite**）                    |
| 鉴权         | `Authorization: Bearer <token>`；登录 `POST /api/auth/login {account,password}` |
| 响应         | 直接返回数据本体（**无 code/data 包装**）；错误用 HTTP 状态码 + `{code,message}` |
| 刷新 token   | 无；401 统一登出                                                     |
| 权限码       | 来自 `GET /api/auth/me` 的 `permissions`，同时用于菜单过滤与按钮级 `v-access:code` |

业务服务层在 `src/api/med/*`，业务类型在 `src/types/med/index.ts`；流式对话（`/api/chat/stream`）使用原生 `fetch` 解析 SSE，不走 axios。

### 页面

| 路径            | 说明                                     |
| --------------- | ---------------------------------------- |
| `/assistant`    | AI 助手会话（落地页，流式对话 + 知识库引用） |
| `/patients`     | 患者档案（列表 + 详情 + 时间线 + 分析演变 + 报告导出） |
| `/documents`    | 文档管理（上传 / 下载 / 预览 / 版本 / AI 总结 / 标签） |
| `/prompts`      | 提示词管理                               |
| `/dictionaries` | 字典管理                                 |
| `/accounts`     | 账号管理                                 |
| `/permissions`  | 权限管理（角色 + 菜单/权限点授权）        |
| `/audit`        | 审计日志                                 |

### Mock 服务（已彻底移除）

已从仓库移除全部 Mock 相关产物：

- `apps/backend-mock/`（目录与 `pnpm-workspace.yaml` 的 `apps/*` 声明）
- `internal/vite-config` 的 `viteNitroMockPlugin`（插件文件、类型、`nitroMock` 开关、`VITE_NITRO_MOCK` 环境变量读取）及其依赖 `nitropack` / `get-port`
- `scripts/remove-mock.mjs` 与 `docs/mock-api.openapi.json`

## API 参考（OpenAPI）

真实后端自带交互式文档，开发时直接访问：

- **FastAPI Swagger**：http://localhost:8001/docs
- **OpenAPI JSON**：http://localhost:8001/openapi.json

导入 Apifox：项目设置 → 导入 → OpenAPI → 填写上述 URL 或粘贴 JSON。

## 其他说明

- 未选中的其他 `apps/web-*` 模板不会出现在本仓库。
- 需要更新 vben 基线时，可使用 create-vben-admin 指定新的 upstream ref 重新生成，或手动合并 upstream 变更。
- 若需进一步裁剪 upstream 能力，可参考 [Vben 官方项目精简说明](https://doc.vben.pro/guide/introduction/thin.html)（与 Mock 移除无关）。

## 链接

- [Vben Admin 文档](https://doc.vben.pro/)
- [vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)
- [create-vben-admin](https://github.com/379949990/create-vben-admin)

## License

MIT（应用代码遵循 upstream 与 create-vben-admin 生成说明；详见各文件头注释。）
