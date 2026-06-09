# Kanna 生产环境部署文档

本文档说明 Kanna 在生产环境中的部署方式，以及 MySQL、Redis、MinIO 等中间件的配置要点。

## 1. 部署模式选择

| 模式 | 适用场景 | 必需中间件 | 数据存储 |
|------|----------|------------|----------|
| **single（默认）** | 个人/单机，单用户 | 无 | 本地 `~/.kanna/data/` JSONL |
| **multiuser** | 团队/多用户、可多实例 | MySQL；生产建议 + MinIO + Redis | MySQL + S3 附件 + 本地项目目录 |

配置入口：[`src/server/kanna-config.ts`](../src/server/kanna-config.ts)

```bash
# 生产 multiuser 推荐组合
KANNA_AUTH_MODE=multiuser
KANNA_STORAGE=mysql
DATABASE_URL=mysql://kanna:***@mysql:3306/kanna
REDIS_URL=redis://redis:6379          # 多实例时建议
KANNA_S3_ENDPOINT=http://minio:9000   # 附件跨实例
KANNA_S3_BUCKET=kanna
KANNA_S3_ACCESS_KEY_ID=***
KANNA_S3_SECRET_ACCESS_KEY=***
KANNA_SECRETS_KEY=***                 # 32+ 字节，加密用户 Provider API Key
```

环境变量模板见 [`deploy/env.example`](../deploy/env.example)。

---

## 2. 架构（multiuser 生产）

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

  subgraph middleware [中间件]
    MySQL[(MySQL)]
    Redis[(Redis Pub/Sub)]
    MinIO[(MinIO / S3)]
  end

  Browser --> Nginx --> App
  App --> MySQL
  App --> Redis
  App --> MinIO
```

**重要约束**：Kanna 会在 **本机** 以 `project.localPath` 为 cwd 启动 Claude/Codex 进程。生产部署时，Kanna 实例必须能访问用户打开的 **真实项目目录**（NFS、同机磁盘等），不是纯无状态 API 服务。

---

## 3. 主机前置条件

| 依赖 | 版本/说明 |
|------|-----------|
| [Bun](https://bun.sh) | >= 1.3.5（[`cli-runtime.ts`](../src/server/cli-runtime.ts) 硬性要求） |
| Claude Code CLI | Agent 提供方，需在 PATH 中 |
| Codex CLI | 可选，启用 OpenAI Codex 时需要 |
| Git | Changes 面板、提交、GitHub 发布 |
| gh CLI | 可选，GitHub 发布功能 |

---

## 4. 中间件配置

### 4.1 MySQL（multiuser 必需）

**用途**：用户/会话、项目/对话/transcript、附件索引（`attachment_objects`）、用户 Provider 配置。

**参考 compose**：[`docker-compose.multiuser.yml`](../docker-compose.multiuser.yml)

```yaml
mysql:
  image: mysql:8.4
  environment:
    MYSQL_ROOT_PASSWORD: <强密码>
    MYSQL_DATABASE: kanna
    MYSQL_USER: kanna
    MYSQL_PASSWORD: <强密码>
  volumes:
    - kanna_mysql_data:/var/lib/mysql
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-ukanna", "-p<密码>"]
```

**连接串**：

```bash
DATABASE_URL=mysql://kanna:<密码>@<host>:3306/kanna
```

**Schema 初始化**：服务启动时自动执行 [`runMigrations`](../src/server/db/migrate.ts)（`CREATE TABLE IF NOT EXISTS`）。

**全新环境清库**（无数据迁移）：

```bash
DATABASE_URL='mysql://...' bun run scripts/reset-kanna-db.ts
```

**生产建议**：

- 独立数据库实例，开启定期备份（mysqldump / 云 RDS 快照）
- 字符集 `utf8mb4`
- 不要使用 compose 中的默认密码

### 4.2 Redis（multiuser 多实例建议）

**用途**：跨 Kanna 实例 WebSocket 刷新（[`RealtimeHub`](../src/server/realtime-hub.ts)）。

- 频道：`kanna:user-events`
- 消息：`user:{userId}`
- 未配置 `REDIS_URL` 时：仅本进程 WS 推送，**刷新页面/重连** 仍可从 MySQL 读到最新数据

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  # 生产建议启用 requirepass 或 ACL
```

```bash
REDIS_URL=redis://:<password>@<host>:6379/0
```

**单实例部署**：可省略 Redis。

### 4.3 MinIO / S3（multiuser 附件必需）

**用途**：附件权威存储 + `attachment_objects` 表索引（[`AttachmentService`](../src/server/attachment-service.ts)）。

```yaml
minio:
  image: minio/minio:latest
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: <access_key>
    MINIO_ROOT_PASSWORD: <secret_key>
  volumes:
    - kanna_minio_data:/data
```

**首次部署必须创建 bucket**（compose 未自动创建）：

```bash
docker exec <minio容器> mc alias set local http://127.0.0.1:9000 <user> <pass>
docker exec <minio容器> mc mb local/kanna
```

**环境变量**：

```bash
KANNA_S3_ENDPOINT=https://minio.example.com   # 或 AWS S3 端点
KANNA_S3_REGION=us-east-1
KANNA_S3_BUCKET=kanna
KANNA_S3_ACCESS_KEY_ID=***
KANNA_S3_SECRET_ACCESS_KEY=***
```

**也可用 AWS S3 / 阿里云 OSS 等**：配置 endpoint + path-style（存在 endpoint 时代码使用 `forcePathStyle: true`）。

---

## 5. Kanna 应用部署

### 5.1 构建

```bash
git clone <repo> && cd my-kanna
bun install
bun run build          # 产出 dist/client
```

或全局安装：

```bash
bun install -g kanna-code
```

### 5.2 启动（生产 single）

```bash
export KANNA_RUNTIME_PROFILE=prod   # 可选，默认 prod

kanna --host 0.0.0.0 --port 3210 --no-open
# 或
kanna --password <启动密码> --host 0.0.0.0
```

### 5.3 启动（生产 multiuser）

通过环境变量 + CLI 启动（当前 **无官方 Dockerfile**，需自行封装或使用 systemd）：

```bash
set -a && source deploy/env.example && set +a   # 复制并修改后使用

kanna --host 0.0.0.0 --port 3210 --no-open --strict-port
```

源码方式：

```bash
bun run start -- --host 0.0.0.0 --port 3210 --no-open
```

**本地数据目录**（diff、部分 settings）：`~/.kanna/data/`（[`branding.ts`](../src/shared/branding.ts)）。

### 5.4 systemd

示例 unit 文件：[`deploy/kanna.service.example`](../deploy/kanna.service.example)

```bash
sudo cp deploy/kanna.service.example /etc/systemd/system/kanna.service
sudo cp deploy/env.example /etc/kanna/env
# 编辑 /etc/kanna/env 填入真实配置
sudo systemctl daemon-reload
sudo systemctl enable --now kanna
```

---

## 6. 反向代理与 HTTPS

默认监听 `3210`，健康检查：`GET /health` → `{"ok":true,"port":3210}`（无需认证）。

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

**注意**：当前 CLI 仅在 `--share` / `--cloudflared` 模式下启用 `trustProxy`（[`cli-runtime.ts`](../src/server/cli-runtime.ts)）。HTTPS 反代下 Cookie `Secure` 与 CSRF Origin 校验，在普通 `--host` 部署时可能需后续增加 `KANNA_TRUST_PROXY=1` 类环境变量（**生产 HTTPS 部署前需验证登录/WS**）。

---

## 7. 初始化与验收

### 7.1 首次用户（multiuser）

1. 访问 `https://kanna.example.com`
2. `POST /auth/register` 注册（用户名 >= 3，密码 >= 8）
3. 登录后打开本地/共享项目目录

### 7.2 验收清单

| 检查项 | 命令/操作 |
|--------|-----------|
| 健康 | `curl https://kanna.example.com/health` |
| MySQL 连通 | 启动无 `DATABASE_URL` 报错 |
| MinIO bucket | 上传附件成功 |
| Redis（多实例） | A 实例发消息，B 实例同用户页面自动刷新 |
| Agent | 发起对话，Claude 正常响应 |
| WS | 浏览器 DevTools 中 `/ws` 101 Switching |

---

## 8. 环境变量速查

| 变量 | 必需 | 说明 |
|------|------|------|
| `KANNA_AUTH_MODE` | multiuser 时 | `single` / `multiuser` |
| `KANNA_STORAGE` | 可选 | `file` / `mysql` |
| `DATABASE_URL` | multiuser 或 mysql 存储 | MySQL 连接串 |
| `REDIS_URL` | 多实例建议 | 跨实例 WS 同步 |
| `KANNA_S3_*` | multiuser 附件 | S3/MinIO 五元组 |
| `KANNA_SECRETS_KEY` | multiuser 建议 | 加密 `user_providers` 中的 API Key |
| `KANNA_RUNTIME_PROFILE` | 可选 | `prod`（默认）/ `dev` |

CLI 参数（非环境变量）：`--port` `--host` `--remote` `--password` `--strict-port` `--no-open`

---

## 9. 安全建议

- 所有中间件使用强密码，不暴露 MySQL/Redis/MinIO 端口到公网
- `KANNA_SECRETS_KEY` 使用随机 32+ 字节，丢失后无法解密已存 Provider 配置
- multiuser 依赖 Session Cookie（`kanna_session`），务必 HTTPS
- 限制 `--host 0.0.0.0` 暴露范围，优先反代 + 内网监听
- 定期备份 MySQL；MinIO bucket 同步备份
- Claude/Codex 在服务器上运行，注意项目目录权限隔离（per-user）

---

## 10. 运维命令

```bash
# 重置数据库（清空全部业务数据，重建 schema）
DATABASE_URL='mysql://...' bun run scripts/reset-kanna-db.ts

# 类型检查 + 构建验证
bun run check

# 测试
bun test
```

---

## 11. 与 docker-compose 一键启动

开发/小规模生产可先起中间件，再起 Kanna 宿主机进程：

```bash
docker compose -f docker-compose.multiuser.yml up -d
# 初始化 MinIO bucket（见 4.3）
# 配置环境变量后启动 kanna
```

当前 compose **不包含 Kanna 应用容器**；Claude 需访问宿主机文件系统，生产常见模式为：**中间件容器化 + Kanna 裸机/VM 部署**。

---

## 12. 已知限制

- 无内置 Dockerfile / K8s Helm（需自行封装）
- Agent 强依赖本机 Claude/Codex 与项目目录
- HTTPS 反代下 `trustProxy` 需确认或扩展
- single 模式不支持多用户共享对话
