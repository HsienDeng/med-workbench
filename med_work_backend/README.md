# MedAI Workbench Backend

医疗 AI 智能分析工作台后端服务：**FastAPI + LangChain + Kimi（Moonshot AI 官方 API）**。

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

### 4. 配置 API Key

```powershell
Copy-Item .env.example .env         # 复制配置模板
```

编辑 `.env`，填入你的真实 Key（前往 https://platform.moonshot.cn/ 获取）：

```ini
AI_PROVIDER=kimi
KIMI_API_KEY=sk-你的真实APIKey
KIMI_MODEL=kimi-2.6                 # 通用模型；编程可选 kimi-k2.7-code
```

> 不配置 `.env` 时服务也能启动，但 `/api/chat`、`/api/analysis` 会返回 503「未配置 API Key」。
> 若已设置全局环境变量 `KIMI_API_KEY`，可省略 `.env`。

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
| GET | `/api/health` | 健康检查与 Kimi 配置状态 |
| POST | `/api/chat` | 对话（非流式） |
| POST | `/api/chat/stream` | 对话（SSE 流式） |
| POST | `/api/analysis` | AI 病历分析（结构化 JSON 输出） |
| GET | `/api/ai/connections` | 查看已注册供应商状态（需登录） |
| PATCH | `/api/ai/active-provider` | 切换当前 AI 路由（需医院管理员） |

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

## 配置项（.env）

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `AI_PROVIDER` | Redis 尚未保存路由时的默认值，支持 `kimi` / `o98k` | `kimi` |
| `KIMI_API_KEY` | Moonshot 平台 API Key | 必填 |
| `KIMI_BASE_URL` | Kimi 官方 API 地址 | `https://api.moonshot.cn/v1` |
| `KIMI_MODEL` | 模型名 | `kimi-2.6` |
| `O98K_API_KEY` | O98K 中转站 API Key | 空值 |
| `O98K_BASE_URL` | O98K 中转站 API 地址 | `https://api.o98k.de/v1` |
| `O98K_MODEL` | O98K 模型名 | `gpt-5.6-sol` |
| `PORT` | 服务端口 | `8001` |

可选模型：
- 通用：`kimi-k3` / `kimi-2.6`
- 编程：`kimi-k2.7-code` / `kimi-k2.7-code-highspeed`

> 注意：`moonshot-v1` 系列与 `kimi-k2.5` 已于 2026-08-31 下线，请勿使用。

配置 O98K 凭据：

```ini
AI_PROVIDER=o98k
O98K_API_KEY=你的O98K中转站APIKey
O98K_BASE_URL=https://api.o98k.de/v1
O98K_MODEL=gpt-5.6-sol
```

运行时路由由医院管理员在前端"API 连接"页面切换，并永久保存到 Redis
`med-workbench:ai:active-provider`。Redis 中尚无该键时才使用 `AI_PROVIDER`；切换不会中断已经开始的请求。
=======
# Med Workbech Backend

