# MedAI Workbench Backend

医疗 AI 智能分析工作台后端服务：**FastAPI + LangChain + 多模型动态路由 + MySQL**。

AI 供应商（OpenAI 兼容 / Anthropic）、API Key、默认模型与当前路由全部存储在数据库中，
由前端「AI 服务与 API Key」管理页维护（仅医院管理员可写），不再通过代码或 `.env` 配置。

## 新电脑启动（从零开始）

### 1. 环境要求

- **Python 3.11+**（官网 https://www.python.org/downloads/ 下载，安装时勾选 **Add to PATH**）
- Windows / macOS / Linux 均可

### 2. 拷贝项目

将 `med_work_backend` 整个目录复制到新电脑（或 `git clone`），进入该目录：

```powershell
cd med_work_backend
```

### 3. 创建虚拟环境并安装依赖

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # Windows PowerShell 激活
# .venv\Scripts\activate            # Windows CMD
# source .venv/bin/activate         # macOS / Linux
pip install -r requirements.txt
```

### 4. 配置环境

```powershell
Copy-Item .env.example .env         # 复制配置模板
```

编辑 `.env`，填写数据库、Redis 连接信息。AI 供应商无需在 `.env` 配置：
服务启动后，由医院管理员登录前端，在侧边栏底部「AI 服务与 API Key」页面添加供应商并保存 API Key。

> 生产环境务必设置 `MED_API_KEY_ENC_KEY`（数据库中 API Key 的 AES-GCM 加密密钥，
> 随机 32+ 位字符串，配置后不要变更）；本地开发可不配，自动使用开发兜底密钥。

### 5. 启动服务

```powershell
python -m uvicorn app.main:app --reload --port 8001
```

### 6. 验证

- 健康检查：`http://localhost:8001/api/health` → `"status":"ok"`
- 交互式文档：`http://localhost:8001/docs`

前端 `med_work_frontend` 的 API 地址若指向 `localhost:8001`，后端启动后即可直接联调。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查与 AI 供应商配置状态 |
| POST | `/api/chat` | 对话（非流式） |
| POST | `/api/chat/stream` | 对话（SSE 流式） |
| POST | `/api/analysis` | AI 病历分析（结构化 JSON 输出） |
| GET | `/api/ai/connections` | 查看已配置供应商状态（需登录） |
| GET | `/api/ai/providers` | AI 供应商配置列表（需登录） |
| POST/PATCH/DELETE | `/api/ai/providers*` | 供应商增删改 / 激活 / 测速 / 拉取模型（需医院管理员） |

## 调用示例

```bash
curl -X POST http://localhost:8001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

病历分析：

```bash
curl -X POST http://localhost:8001/api/analysis \
  -H "Content-Type: application/json" \
  -d '{"text":"患者反复胸闷、气促3天，高血压病史10年，肌钙蛋白0.12ng/mL","analysis_type":"record"}'
```

## AI 供应商配置

供应商、API Key、模型与当前路由均存储在 `med_ai_provider_configs` 表，
由「AI 服务与 API Key」管理页维护（支持 OpenAI 兼容与 Anthropic 协议、连通性测速、
在线拉取模型列表）。API Key 以 AES-GCM 加密落库，密钥为 `.env` 中的 `MED_API_KEY_ENC_KEY`。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MED_API_KEY_ENC_KEY` | 数据库中 API Key 的加密密钥 | 空（开发兜底） |
| `PORT` | 服务端口 | `8001` |
