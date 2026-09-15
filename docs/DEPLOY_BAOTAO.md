# Med Workbench 生产发布指南（宝塔面板）

> 适用于目标服务器为**宝塔面板（Linux）**、从代码提交到上线的一次性部署与日常增量更新。
> 本地环境为 Windows + PowerShell，服务器为宝塔 Linux，本文按两端分别给出命令。

---

## 一、架构与端口

| 组件 | 目录 | 端口 | 对外 | 说明 |
|---|---|---|---|---|
| 前端（Vite React） | `med_work_frontend/` | 8080（仅开发） | 80/443 | 生产用 Nginx 托管 `dist/` 静态文件 |
| 服务 A（FastAPI 主服务） | `med_work_backend/` | 8001 | 仅内网 | 鉴权 / AI 对话 / 病历等全部业务，Nginx 反代 `/api` |
| 服务 B（RAG 服务） | `med_rag_service/` | 8002 | 仅内网 | 文档解析 / 向量化 / Qdrant，仅服务 A 调用 |
| MySQL 8 | 宝塔软件 | 3306 | 内网 | 业务库 `med_workbench` |
| Redis | 宝塔软件 | 6379 | 内网 | 会话 token、AI 路由 |

启动顺序：**先 B（RAG）后 A（主服务）**；B 未启动时知识库接口返回 503，聊天与登录不受影响。

---

## 二、本地准备（每次发布前）

### 2.1 日志文件清理（已完成）

9 个运行日志文件（`_uvicorn*.log`、`logs/backend*.log`、`_vite.log`）原先被 git 跟踪，
本次已执行：

```powershell
git rm --cached <9 个日志文件>   # 从索引移除，磁盘文件保留
```

根目录 `.gitignore` 已追加：

```gitignore
# 服务运行日志（运行时生成，不应提交）
**/_uvicorn*.log
**/_vite.log
**/logs/*.log
```

以后日志不会再误提交。若本地再生成新日志，无需任何处理。

### 2.2 提交代码

```powershell
cd d:\project\med-workbench
git add -A
git status                # 确认：无 .log、无 .env、无 node_modules、无 dist
git commit -m "feat: 病历 AI 智能导入 + 弹窗优化"
git push origin main      # origin = http://192.168.18.106/med_workbench/med_workbech_backend.git
```

> 注意：根目录 `README.md` 中存在历史遗留的合并冲突标记（`=======`），
> 建议发布前顺手清理，避免污染仓库。

### 2.3 本地构建验证（可选，推荐）

```powershell
cd d:\project\med-workbench\med_work_frontend
npm run build             # 通过则说明类型与打包无误
```

---

## 三、服务器首次部署（宝塔）

### 3.1 安装软件（宝塔 → 软件商店）

- **Nginx**（1.22+）
- **MySQL**（8.0+，要求 8.0.19+，checkpoint 表依赖 `JSON_TABLE`）
- **Redis**（任意稳定版，设置密码）
- **Python 项目管理器**（3.11 或 3.12，或系统编译 Python 3.11+）
- **Node.js 版本管理器**（18+）
- **进程守护管理器**（Supervisor，用于守护两个后端进程）

### 3.2 规划目录

```bash
/www/wwwroot/med_workbench/
├── med_work_backend/      # 服务 A
├── med_rag_service/       # 服务 B
└── med_work_frontend/     # 前端源码（构建产物 dist/ 由站点根目录指向）
```

### 3.3 拉取代码

宝塔 → 文件 → `/www/wwwroot/med_workbench`，上传压缩包解压，或宝塔「终端」执行：

```bash
cd /www/wwwroot
# 若 git 仓库需要认证，先在宝塔面板配置好 SSH key 或使用带凭证的地址
git clone http://192.168.18.106/med_workbench/med_workbech_backend.git med_workbench
```

### 3.4 初始化数据库

宝塔 → 数据库 → 添加数据库：

- 数据库名：`med_workbench`（字符集 `utf8mb4`）
- 用户名/密码：生成或自定义（建议专用账号，不要用 root）
- 授权主机：`localhost`

业务表由后端启动时自动创建（`Base.metadata.create_all` 幂等建表），无需手工导入 SQL。

### 3.5 配置 `.env`（两个服务）

两个服务是独立进程，各自读取自己目录下的 `.env`，DB 配置必须两边一致。

**服务 A** `med_work_backend/.env`（参考 `med_work_backend/.env.example`）：

```ini
AI_PROVIDER=o98k
O98K_API_KEY=你的O98K密钥
O98K_BASE_URL=https://api.o98k.de/v1
O98K_MODEL=gpt-5.6-sol

PORT=8001
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=med_workbench
DB_PASSWORD=数据库密码
DB_NAME=med_workbench

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=你的Redis密码
REDIS_DB=0

RAG_SERVICE_BASE_URL=http://127.0.0.1:8002
RAG_SERVICE_TIMEOUT=300

# 企业微信 / IMA 等按需填写
```

**服务 B** `med_rag_service/.env`（参考 `med_rag_service/.env.example`）：

```ini
PORT=8002
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=med_workbench
DB_PASSWORD=数据库密码
DB_NAME=med_workbench

UPLOAD_DIR=./data/uploads
QDRANT_PATH=./data/qdrant
EMBEDDING_MODEL_NAME=./models/bge-base-zh-v1.5
EMBEDDING_DEVICE=cpu
EMBEDDING_BATCH_SIZE=8
MAX_UPLOAD_MB=50

LLM_CHUNKING=true
LLM_CHUNK_MAX_INPUT=12000
LLM_API_KEY=你的O98K密钥       # 与服务 A 的 O98K_API_KEY 同一个
LLM_BASE_URL=https://api.o98k.de/v1
LLM_MODEL=gpt-5.6-sol
LLM_TIMEOUT=120
```

> 若服务器无法直连 `https://api.o98k.de`（该域名在境外），AI 对话与 LLM 语义切分会失败。
> 两个 `.env` 都需同步处理：要么给服务器配代理，要么将 `AI_PROVIDER` / `LLM_*` 换为国内可达的 kimi 配置。

### 3.6 安装后端依赖 + 下载向量模型

```bash
cd /www/wwwroot/med_workbench/med_work_backend

# 1) 虚拟环境（两个服务共用一个 .venv，避免重复安装 400MB+ 依赖）
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
.venv/bin/pip install -r ../med_rag_service/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 2) 下载 embedding 模型（ModelScope 国内源，服务器可直连）
.venv/bin/pip install modelscope
cd ../med_rag_service
/workspace/med_workbench/med_work_backend/.venv/bin/python scripts/download_embedding_model.py
# 完成后确认：med_rag_service/models/bge-base-zh-v1.5/config.json 存在
```

> 模型目录（约 400MB）不在 git 中（已 .gitignore），首次部署必须执行上一步。
> 如服务器内存小于 2GB，建议增大 swap（宝塔 → 系统 → Swap）。

### 3.7 启动两个服务（进程守护管理器）

宝塔 → 软件商店 → 进程守护管理器 → 添加守护进程（两个，**先加 B 后加 A**，B 的 `startsecs` 可稍大）：

**进程 1：服务 B（RAG）**

- 名称：`med-rag`
- 运行目录：`/www/wwwroot/med_workbench/med_rag_service`
- 启动命令：

```bash
/www/wwwroot/med_workbench/med_work_backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8002
```

**进程 2：服务 A（主服务）**

- 名称：`med-api`
- 运行目录：`/www/wwwroot/med_workbench/med_work_backend`
- 启动命令：

```bash
/www/wwwroot/med_workbench/med_work_backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

> 两个服务都只监听 `127.0.0.1`，由 Nginx 反代对外，不直接暴露端口。

### 3.8 构建前端

```bash
cd /www/wwwroot/med_workbench/med_work_frontend
npm install --registry=https://registry.npmmirror.com
npm run build        # 产物在 med_work_frontend/dist/
```

> 前端 `.env` 文件仅用于**本地开发**（`.env.development` 的 `VITE_API_TARGET` 指定 dev 代理目标）。
> 生产构建**不需要**任何前端环境变量：构建产物请求为相对路径 `/api/*`，由 Nginx 同源反代到后端。

### 3.9 配置 Nginx 站点

宝塔 → 网站 → 添加站点，域名填你的域名（或服务器 IP），**根目录指向前端构建产物**：

```nginx
server {
    listen 80;
    server_name your-domain.com;              # 你的域名或 IP

    root /www/wwwroot/med_workbench/med_work_frontend/dist;
    index index.html;

    # 上传大小：与 MAX_UPLOAD_MB=50 对齐
    client_max_body_size 60m;

    # API 反向代理 → 服务 A（8001）
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        # SSE 流式对话需要关闭缓冲
        proxy_buffering off;
    }

    # 前端 history 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

若使用 HTTPS：宝塔 → 网站 → SSL → Let's Encrypt 申请证书后自动续期。

---

## 四、验证

```bash
# 服务状态
curl http://127.0.0.1:8001/api/health    # status/database/redis/ai 均 ok
curl http://127.0.0.1:8002/health        # status ok（embedding 懒加载，首次检索后变 true）

# 浏览器访问
#   http://your-domain.com    → 登录页
#   默认账号 admin / Admin@123（仅首次初始化生效，登录后请立即改密）
```

功能冒烟：

1. 登录 → 知识库上传一篇文档（走 B 的解析/向量化链路）
2. AI 对话发送一条消息（走 A 的 LangGraph + o98k）
3. 病历 → 新建病历 → AI 智能导入（上传图片/PDF，走 vision 解析）

---

## 五、日常增量发布（下次发版）

```bash
# 1) 服务器拉代码
cd /www/wwwroot/med_workbench && git pull origin main

# 2) 依赖有变化才执行
cd med_work_backend && .venv/bin/pip install -r requirements.txt

# 3) 重启两个服务（宝塔 → 进程守护管理器 → 重启，先 B 后 A）

# 4) 前端重新构建（源码有变化时）
cd ../med_work_frontend && npm run build
```

> 前端 `dist/` 覆盖后无需重启 Nginx，刷新页面即生效（浏览器缓存可加 Ctrl+F5）。

---

## 六、回滚

```bash
# 代码回滚
cd /www/wwwroot/med_workbench
git log --oneline -5
git checkout <上一版本commit> -- med_work_backend med_rag_service med_work_frontend
# 重启两个服务

# 前端回滚：更新前先备份
cp -r med_work_frontend/dist dist_backup_$(date +%Y%m%d)
# 回滚时把备份还原到站点根目录即可
```

数据库无需手工回滚：本次发布未引入破坏性表结构变更（表结构由 `create_all` 幂等维护）。

---

## 七、安全与注意事项

| 事项 | 说明 |
|---|---|
| 默认密码 | `admin/Admin@123` 仅首次生效，上线后立即在系统内修改 |
| 服务 B 不暴露公网 | 仅监听 `127.0.0.1`；宝塔防火墙只放行 80/443 |
| o98k 网络可达性 | `api.o98k.de` 为境外域名；不可达时切换 `AI_PROVIDER=kimi`（国内可达） |
| 密钥安全 | `.env` 不入库；数据库/Redis 密码使用强密码并两边 `.env` 同步 |
| 日志 | 服务日志写 `_uvicorn*.log`、`logs/`，已 .gitignore；宝塔日志切割工具可配置按天切割 |
| 数据备份 | 宝塔计划任务：每天备份 MySQL 的 `med_workbench` 库 + `med_rag_service/data/`（上传文件与向量库） |
| Redis 密码 | 若启用密码，`REDIS_PASSWORD` 必须与宝塔 Redis 配置一致，否则登录会降级 |
| 内存 | embedding 模型 + Qdrant 建议服务器 ≥ 4GB 内存；不足时开 Swap |
