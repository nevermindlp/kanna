# Kanna 生产环境部署文档

本文档说明 Kanna 的部署方式，涵盖 Docker Hub 多架构镜像、Docker 全栈启动、中间件 + 宿主机进程、以及生产 VM/systemd 部署。

相关文件：

| 文件 | 用途 |
|------|------|
| [`Dockerfile`](../Dockerfile) | 多阶段 Bun 镜像（本地构建 / CI） |
| [`docker-compose.multiuser.yml`](../docker-compose.multiuser.yml) | MySQL / Redis / Kanna（可选） |
| [`deploy/env.example`](../deploy/env.example) | multiuser 环境变量模板 |
| [`deploy/kanna.service.example`](../deploy/kanna.service.example) | systemd unit 模板 |
| [`deploy/README.md`](../deploy/README.md) | 快速命令速查 |

配置解析入口：[`src/server/kanna-config.ts`](../src/server/kanna-config.ts)

---

## 1. 部署路径选择

| 路径 | 适用场景 | Kanna 运行方式 | 中间件 |
|------|----------|----------------|--------|
| **A. Docker 全栈** | 本地开发、PoC、远程服务器 | Docker Hub 镜像 `hilpdocker/kanna` | compose 一键启动 |
| **B. 中间件容器 + 宿主机 Kanna** | 生产推荐（Agent 在宿主机） | Bun / systemd 裸机 | compose 仅起中间件 |
| **C. single 模式** | 个人单机 | 宿主机 `kanna` CLI | 无 |

multiuser 模式必需 **MySQL**；附件存储需要 **S3 兼容对象存储**（生产推荐华为云 OBS）；多 Kanna 实例横向扩展建议 **Redis**。

```bash
# multiuser 推荐环境变量组合
KANNA_AUTH_MODE=multiuser
KANNA_STORAGE=mysql
DATABASE_URL=mysql://kanna:***@127.0.0.1:3306/kanna
REDIS_URL=redis://127.0.0.1:6379
KANNA_S3_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com
KANNA_S3_REGION=cn-north-4
KANNA_S3_BUCKET=kanna-attachments-prod
KANNA_S3_ACCESS_KEY_ID=***
KANNA_S3_SECRET_ACCESS_KEY=***
KANNA_SECRETS_KEY=***                 # 32+ 字节，加密用户 Provider API Key
KANNA_DISABLE_SELF_UPDATE=1           # Docker / 固定版本部署建议开启
```

---

## 2. Docker 镜像说明

### 2.1 Docker Hub 官方镜像（推荐）

Kanna 应用镜像已发布至 Docker Hub，**同时支持 `linux/amd64` 与 `linux/arm64`**，无需按目标平台分别构建。

| 属性 | 值 |
|------|-----|
| 仓库 | [`hilpdocker/kanna`](https://hub.docker.com/r/hilpdocker/kanna) |
| 推荐标签 | `latest`（多架构）/ `amd64` / `arm64`（单架构） |
| 架构 | `linux/amd64`、`linux/arm64` |
| 基础镜像 | `oven/bun:1.3.5` |
| 体积 | ~1.2 GB |
| 监听端口 | `3210` |
| 入口 | `bun src/server/cli.ts` |
| 默认 CMD | `--host 0.0.0.0 --port 3210 --no-open` |
| 内置 ENV | `NODE_ENV=production`、`KANNA_DISABLE_SELF_UPDATE=1` |
| 健康检查 | `GET http://127.0.0.1:3210/health`，30s 间隔，30s 启动宽限期 |

**拉取与验证**：

```bash
# 自动拉取与当前 CPU 匹配的架构
docker pull hilpdocker/kanna:latest

# 固定单架构（可选）
docker pull hilpdocker/kanna:amd64
docker pull hilpdocker/kanna:arm64

# 查看多架构 manifest
docker manifest inspect hilpdocker/kanna:latest

# 检查 Bun 版本
docker run --rm --entrypoint bun hilpdocker/kanna:latest --version
# 期望输出: 1.3.5
```

在 **Apple Silicon（arm64）** 与 **x86_64 服务器（amd64）** 上使用同一镜像名即可；Docker 会自动选择对应架构的层。

### 2.2 镜像内包含的内容

| 路径 | 说明 |
|------|------|
| `/app/dist/client` | Web UI 静态资源 |
| `/app/dist/export-viewer` | 独立 transcript 导出页 |
| `/app/src/server` | Bun 服务端源码 |
| `/app/src/shared` | 共享模块 |
| `/app/bin/kanna` | CLI 包装脚本 |
| `/app/node_modules` | 生产依赖 |

### 2.3 镜像内**不包含**的内容

| 缺失项 | 影响 | 处理方式 |
|--------|------|----------|
| Claude Code CLI | Agent 无法调用 Claude | 宿主机安装后挂载 PATH，或扩展 Dockerfile |
| Codex CLI | 无法使用 OpenAI Codex Agent | 同上 |
| Git | Changes 面板、提交功能受限 | 扩展 Dockerfile 或挂载 |
| 用户项目目录 | Agent 无 cwd | 挂载宿主机目录到 `/projects` |

> **结论**：镜像封装的是 **Kanna Web 服务本身**；Agent 能力仍依赖容器内或挂载路径中的 Claude/Codex 与真实项目目录。生产环境常见模式为 **中间件容器化 + Kanna 宿主机部署**；Docker 全栈适合功能验证、PoC 与 homelab。

### 2.4 本地构建（可选）

源码改动、私有 fork 或无法访问 Docker Hub 时，可在仓库根目录自行构建：

```bash
docker build -t hilpdocker/kanna:local .

# compose 使用本地标签
export KANNA_IMAGE=hilpdocker/kanna:local
docker compose -f docker-compose.multiuser.yml --profile app up -d --build
```

多架构发布（维护者）：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t hilpdocker/kanna:latest \
  -t hilpdocker/kanna:amd64 \
  -t hilpdocker/kanna:arm64 \
  --push .
```

---

## 3. 快速启动：Docker 全栈

以下流程适用于 macOS（arm64）、Linux amd64 服务器等任意已支持架构。

### 3.1 第一步：拉取镜像并启动中间件

```bash
cd /path/to/my-kanna   # 仅需 docker-compose.multiuser.yml，不必 clone 全量源码
mkdir -p projects      # Agent 项目目录，挂载到容器 /projects

docker pull hilpdocker/kanna:latest
docker compose -f docker-compose.multiuser.yml up -d
```

启动内容：

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| mysql | `mysql:8.4` | 3306 | 用户/会话/对话数据 |
| redis | `redis:7-alpine` | 6379 | 跨实例 WS 同步 |

compose 内置 MySQL 开发凭据（**生产必须修改**）：

| 组件 | 用户 | 密码 |
|------|------|------|
| MySQL | `kanna` | `kanna_secret` |

对象存储（附件）需单独配置 **华为云 OBS** 或 `--profile local-dev` 启动本地 MinIO（见 §5.3）。

等待 MySQL 健康：

```bash
docker compose -f docker-compose.multiuser.yml ps
# mysql 状态应为 healthy
```

### 3.2 第二步：启动 Kanna 容器

**方式 A — compose（推荐）**

```bash
export KANNA_PROJECTS_DIR=/path/to/your/projects   # 可选，默认 ./projects
# 华为云 OBS（或本地 MinIO 调试时的 endpoint）
export KANNA_S3_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com
export KANNA_S3_REGION=cn-north-4
export KANNA_S3_BUCKET=kanna-attachments-prod
export KANNA_S3_ACCESS_KEY_ID=***
export KANNA_S3_SECRET_ACCESS_KEY=***
# 可选：export KANNA_IMAGE=hilpdocker/kanna:amd64

docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build
```

compose 默认镜像为 `hilpdocker/kanna:latest`，可通过环境变量 `KANNA_IMAGE` 覆盖。

若使用本地构建镜像，去掉 `--no-build` 或设置 `KANNA_IMAGE` 指向本地标签。

**方式 B — 单独 `docker run`**

适用于 compose 外单独管理 Kanna 容器：

```bash
docker run -d \
  --name my-kanna-kanna-1 \
  --network my-kanna_default \
  --restart unless-stopped \
  -p 3210:3210 \
  -e KANNA_RUNTIME_PROFILE=prod \
  -e KANNA_AUTH_MODE=multiuser \
  -e KANNA_STORAGE=mysql \
  -e DATABASE_URL=mysql://kanna:kanna_secret@mysql:3306/kanna \
  -e REDIS_URL=redis://redis:6379 \
  -e KANNA_S3_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com \
  -e KANNA_S3_REGION=cn-north-4 \
  -e KANNA_S3_BUCKET=kanna-attachments-prod \
  -e KANNA_S3_ACCESS_KEY_ID=*** \
  -e KANNA_S3_SECRET_ACCESS_KEY=*** \
  -e KANNA_SECRETS_KEY=dev-kanna-secrets-key-32bytes!! \
  -e KANNA_DISABLE_SELF_UPDATE=1 \
  -e KANNA_TRUST_PROXY=0 \
  -v my-kanna_kanna_data:/root/.kanna \
  -v "$(pwd)/projects:/projects" \
  hilpdocker/kanna:latest \
  --host 0.0.0.0 --port 3210 --no-open --strict-port
```

> 网络名 `my-kanna_default` 为 compose 项目默认网络；若项目目录名不同，用 `docker network ls | grep kanna` 确认。

### 3.3 远程服务器部署

在 amd64 Linux 服务器上流程相同，无需交叉编译：

```bash
docker pull hilpdocker/kanna:latest
docker compose -f docker-compose.multiuser.yml up -d
export KANNA_IMAGE=hilpdocker/kanna:latest
export KANNA_PROJECTS_DIR=/data/projects
docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build
```

升级版本：

```bash
docker pull hilpdocker/kanna:latest
docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build
```

### 3.4 验收

```bash
curl http://127.0.0.1:3210/health
# {"ok":true,"port":3210}

docker ps --filter name=my-kanna
docker compose -f docker-compose.multiuser.yml --profile app logs -f kanna
```

浏览器访问 http://127.0.0.1:3210 ，注册首个 multiuser 账号（用户名 ≥ 3，密码 ≥ 8）。

上传聊天附件后，在华为云 OBS 控制台对应桶中应可见对象；启动日志中不应出现 object storage connectivity 警告。

### 3.5 停止与清理

```bash
docker compose -f docker-compose.multiuser.yml --profile app stop kanna
docker compose -f docker-compose.multiuser.yml down
docker compose -f docker-compose.multiuser.yml down -v   # 连数据卷一起删除，慎用
```

---

## 4. 架构（multiuser）

```mermaid
flowchart TB
  subgraph clients [客户端]
    Browser[浏览器 WebSocket + HTTP]
  end

  subgraph lb [可选负载均衡]
    Nginx[Nginx / Cloudflare]
  end

  subgraph kanna [Kanna 实例 x N]
    App[Bun Server :3210]
    Claude[Claude Code / Codex 子进程]
    Projects[用户项目目录 localPath]
    App --> Claude
    Claude --> Projects
  end

  subgraph middleware [中间件与云服务]
    MySQL[(MySQL)]
    Redis[(Redis Pub/Sub)]
    OBS[(华为云 OBS / S3)]
  end

  Browser --> Nginx --> App
  App --> MySQL
  App --> Redis
  App --> OBS
```

**重要约束**：Kanna 以 `project.localPath` 为 cwd 启动 Claude/Codex 子进程。实例必须能访问 **真实项目目录**（本地磁盘、NFS 等），不是纯无状态 API。

---

## 5. 中间件配置

### 5.1 MySQL（multiuser 必需）

**用途**：用户/会话、项目/对话/transcript、附件索引、用户 Provider 配置。

Schema 在启动时自动迁移（[`runMigrations`](../src/server/db/migrate.ts)）。

**连接串**：

```bash
# Docker compose 网络内
DATABASE_URL=mysql://kanna:<密码>@mysql:3306/kanna

# 宿主机 Kanna 连接 compose 暴露的端口
DATABASE_URL=mysql://kanna:<密码>@127.0.0.1:3306/kanna
```

**全新环境清库**：

```bash
DATABASE_URL='mysql://...' bun run scripts/reset-kanna-db.ts
```

**生产建议**：独立实例、`utf8mb4`、定期备份、不使用 compose 默认密码。

### 5.2 Redis（多实例建议）

**用途**：跨 Kanna 实例 WebSocket 刷新（[`RealtimeHub`](../src/server/realtime-hub.ts)）。

- 频道：`kanna:user-events`
- 未配置时：仅本进程 WS 推送；刷新页面仍可从 MySQL 读最新数据

单实例部署可省略 Redis。

### 5.3 对象存储（multiuser 附件必需）

**用途**：附件权威存储 + `attachment_objects` 表索引。Kanna 通过 S3 兼容 API（`PutObject` / `GetObject`）读写，浏览器经 `/api/attachments/` 代理访问，不暴露 OBS 直链。

**生产推荐：华为云 OBS**

1. 控制台 → 对象存储 OBS → 创建 **私有** 桶（如 `kanna-attachments-prod`）
2. IAM → 创建用户 → 编程访问 → 授予该桶 PutObject / GetObject 权限 → 获取 AK/SK
3. 宿主机 `/etc/kanna/env` 配置（endpoint 必须为 **区域级** 域名，不要写 `bucketname.obs...`）：

```bash
KANNA_S3_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com
KANNA_S3_REGION=cn-north-4
KANNA_S3_BUCKET=kanna-attachments-prod
KANNA_S3_ACCESS_KEY_ID=***
KANNA_S3_SECRET_ACCESS_KEY=***
# 可选，一般无需设置（OBS 默认 virtual-host）：
# KANNA_S3_FORCE_PATH_STYLE=0
```

| 区域 | `KANNA_S3_REGION` | `KANNA_S3_ENDPOINT` |
|------|-------------------|---------------------|
| 华北-北京四 | `cn-north-4` | `https://obs.cn-north-4.myhuaweicloud.com` |
| 华东-上海一 | `cn-east-3` | `https://obs.cn-east-3.myhuaweicloud.com` |
| 华南-广州 | `cn-south-1` | `https://obs.cn-south-1.myhuaweicloud.com` |

启动时 Kanna 会对桶执行 `HeadBucket` 自检；失败会在日志中输出 `[kanna] Object storage connectivity check failed`。

**故障排查**

| 现象 | 处理 |
|------|------|
| `SignatureDoesNotMatch` | 检查 AK/SK；endpoint 勿含 bucket 前缀；region 与桶一致 |
| `PermanentRedirect` | `KANNA_S3_REGION` 改为桶实际 region |
| 连接超时 | 宿主机出网 / VPC 内网 endpoint；安全组放行 443 |
| 读写风格不匹配 | 尝试 `KANNA_S3_FORCE_PATH_STYLE=0` 或 `1` |

**本地开发：可选 MinIO**

```bash
docker compose -f docker-compose.multiuser.yml --profile local-dev up -d
```

```bash
KANNA_S3_ENDPOINT=http://127.0.0.1:9000
KANNA_S3_REGION=us-east-1
KANNA_S3_BUCKET=kanna
KANNA_S3_ACCESS_KEY_ID=kanna
KANNA_S3_SECRET_ACCESS_KEY=kanna_secret
```

MinIO 控制台：http://127.0.0.1:9001（`kanna` / `kanna_secret`）。

也可使用 AWS S3、阿里云 OSS 等 S3 兼容服务；自定义 endpoint 时 path-style 由 [`resolveS3ForcePathStyle`](../src/server/kanna-config.ts) 自动推断，或通过 `KANNA_S3_FORCE_PATH_STYLE` 覆盖。

---

## 6. Kanna 应用部署（宿主机 / 生产）

### 6.1 前置条件

| 依赖 | 版本/说明 |
|------|-----------|
| [Bun](https://bun.sh) | >= 1.3.5（硬性要求） |
| Claude Code CLI | Agent 提供方，需在 PATH 中 |
| Codex CLI | 可选 |
| Git | Changes 面板、提交 |
| gh CLI | 可选，GitHub 发布 |

### 6.2 源码 / npm 安装

```bash
git clone https://github.com/hilpdocker/kanna.git && cd kanna
bun install && bun run build
```

或全局安装：

```bash
bun install -g kanna-code
```

### 6.3 中间件容器 + 宿主机 Kanna（生产推荐）

Agent 需在宿主机直接访问 Claude/Codex 与项目目录时，推荐此模式；Kanna 应用仍可用 Docker Hub 镜像跑在中间件旁，但 Agent 体验最佳的是宿主机进程：

```bash
docker compose -f docker-compose.multiuser.yml up -d

cp deploy/env.example /etc/kanna/env
# 编辑：127.0.0.1 指向 compose 暴露的 MySQL/Redis 端口；KANNA_S3_* 指向华为云 OBS

set -a && source /etc/kanna/env && set +a
kanna --host 0.0.0.0 --port 3210 --no-open --strict-port
```

### 6.4 systemd

```bash
sudo cp deploy/kanna.service.example /etc/systemd/system/kanna.service
sudo cp deploy/env.example /etc/kanna/env
sudo systemctl daemon-reload
sudo systemctl enable --now kanna
```

### 6.5 single 模式（无需中间件）

```bash
kanna --host 0.0.0.0 --port 3210 --no-open
# 数据目录: ~/.kanna/data/
```

---

## 7. 反向代理与 HTTPS

健康检查：`GET /health` → `{"ok":true,"port":3210}`（无需认证）。

**Nginx 示例**（需 WebSocket）：

```nginx
upstream kanna {
  server 127.0.0.1:3210;
}

server {
  listen 443 ssl http2;
  server_name kanna.example.com;

  location / {
    proxy_pass http://kanna;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 86400;
  }
}
```

HTTPS 反代后设置 `KANNA_TRUST_PROXY=1`。Docker 直连访问保持 `KANNA_TRUST_PROXY=0`。

---

## 8. 环境变量速查

| 变量 | 必需 | 说明 |
|------|------|------|
| `KANNA_AUTH_MODE` | multiuser 时 | `single` / `multiuser` |
| `KANNA_STORAGE` | 可选 | `file` / `mysql` |
| `DATABASE_URL` | multiuser 或 mysql 存储 | MySQL 连接串 |
| `REDIS_URL` | 多实例建议 | 跨实例 WS 同步 |
| `KANNA_S3_*` | multiuser 附件 | endpoint / region / bucket / AK/SK |
| `KANNA_S3_FORCE_PATH_STYLE` | 可选 | `1`/`0`；未设置时按 endpoint 自动推断（OBS→virtual-host，MinIO→path-style） |
| `KANNA_SECRETS_KEY` | multiuser 建议 | 加密 `user_providers` API Key |
| `KANNA_TRUST_PROXY` | HTTPS 反代时 | `1` / `true` / `yes` |
| `KANNA_DISABLE_SELF_UPDATE` | Docker 建议 | `1` 跳过 npm 自更新检查 |
| `KANNA_RUNTIME_PROFILE` | 可选 | `prod`（默认）/ `dev` |
| `KANNA_IMAGE` | compose 专用 | 覆盖 Kanna 容器镜像，默认 `hilpdocker/kanna:latest` |

CLI 参数：`--port` `--host` `--remote` `--password` `--strict-port` `--no-open`

---

## 9. 验收清单

| 检查项 | 命令/操作 |
|--------|-----------|
| 镜像架构 | `docker manifest inspect hilpdocker/kanna:latest` 含 amd64 + arm64 |
| 健康 | `curl http://127.0.0.1:3210/health` |
| 容器健康 | `docker ps` 中 kanna 为 `(healthy)` |
| MySQL 连通 | 启动无 `DATABASE_URL` 报错 |
| OBS 连通 | 启动无 object storage 警告；上传附件成功 |
| Redis（多实例） | A 实例发消息，B 实例同用户页面自动刷新 |
| Agent | 发起对话，Claude 正常响应（需 CLI 可用） |
| WebSocket | DevTools 中 `/ws` 返回 101 |

---

## 10. 安全建议

- 中间件使用强密码，MySQL/Redis 不暴露公网；OBS 使用 IAM 最小权限 AK/SK
- `KANNA_SECRETS_KEY` 随机 32+ 字节；丢失后无法解密已存 Provider 配置
- multiuser 依赖 Session Cookie（`kanna_session`），生产务必 HTTPS
- 限制 `--host 0.0.0.0` 暴露范围，优先反代 + 内网监听
- 定期备份 MySQL；OBS 桶开启版本控制或跨区域复制（按合规需求）
- 生产环境可 pin 到 `amd64` / `arm64` 单架构标签，或等待发布 semver 版本标签

---

## 11. 运维命令

```bash
# 拉取并重启 Kanna
docker pull hilpdocker/kanna:latest
export KANNA_IMAGE=hilpdocker/kanna:latest
docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build

# 重置数据库
DATABASE_URL='mysql://...' bun run scripts/reset-kanna-db.ts

# 查看 compose 服务
docker compose -f docker-compose.multiuser.yml ps

# 本地构建（维护者）
docker build -t hilpdocker/kanna:local .
export KANNA_IMAGE=hilpdocker/kanna:local
docker compose -f docker-compose.multiuser.yml --profile app up -d --build
```

---

## 12. 已知限制

- 镜像封装 Web 服务；Agent 依赖 Claude/Codex CLI 与可访问的项目目录
- 镜像未内置 Git；Changes 相关功能需在镜像或挂载中补充
- single 模式不支持多用户共享对话
- `latest` 标签会随发布更新；生产建议 pin 到具体版本号
