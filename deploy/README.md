# Deploy assets

Kanna 部署模板与快速命令。完整说明见 [`docs/production-deployment.md`](../docs/production-deployment.md)。

| 文件 | 用途 |
|------|------|
| [`env.example`](env.example) | multiuser 环境变量模板 |
| [`kanna.service.example`](kanna.service.example) | systemd unit 模板 |
| [`../Dockerfile`](../Dockerfile) | 多阶段 Bun 镜像（本地构建用） |
| [`../docker-compose.multiuser.yml`](../docker-compose.multiuser.yml) | MySQL / Redis + 可选 Kanna 容器 |

---

## Docker Hub 全栈（推荐）

镜像地址：[hilpdocker/kanna](https://hub.docker.com/r/hilpdocker/kanna)（**linux/amd64** + **linux/arm64**）

```bash
# 1. 拉取镜像（自动匹配当前 CPU 架构）
docker pull hilpdocker/kanna:latest
# 或固定单架构：docker pull hilpdocker/kanna:amd64

# 2. 启动中间件（MySQL + Redis）
mkdir -p projects
docker compose -f docker-compose.multiuser.yml up -d

# 3. 启动 Kanna（需配置 OBS 等环境变量，见 deploy/env.example）
export KANNA_PROJECTS_DIR=./projects   # 可选
export KANNA_S3_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com
export KANNA_S3_REGION=cn-north-4
export KANNA_S3_BUCKET=c-poc-storage
export KANNA_S3_KEY_PREFIX=AI-codeflow
export KANNA_S3_ACCESS_KEY_ID=***
export KANNA_S3_SECRET_ACCESS_KEY=***
docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build

# 4. 验收
curl http://127.0.0.1:3210/health
open http://127.0.0.1:3210
```

切换镜像版本：

```bash
export KANNA_IMAGE=hilpdocker/kanna:amd64
docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build
```

访问地址：

| 服务 | URL | 说明 |
|------|-----|------|
| Kanna | http://127.0.0.1:3210 | 首次注册 multiuser 账号 |

---

## 生产推荐：中间件 Docker + 宿主机 Kanna

对象存储使用 **华为云 OBS**（S3 兼容），不在 compose 中自建 MinIO。

```bash
# 仅中间件
docker compose -f docker-compose.multiuser.yml up -d

# 宿主机配置
cp deploy/env.example /etc/kanna/env
# 编辑 DATABASE_URL / REDIS_URL / KANNA_S3_* 指向 MySQL、Redis 与华为云 OBS

sudo cp deploy/kanna.service.example /etc/systemd/system/kanna.service
sudo systemctl daemon-reload
sudo systemctl enable --now kanna
```

### 华为云 OBS 开通要点

1. 控制台创建 **私有** 桶（如 `c-poc-storage`），记录 region（如 `cn-north-4`）
2. 确定桶内目录前缀（如 `obs://c-poc-storage/AI-codeflow` → `KANNA_S3_KEY_PREFIX=AI-codeflow`）
3. IAM 用户开启编程访问，授予该桶的 PutObject / GetObject 权限
4. 在 `/etc/kanna/env` 配置 `KANNA_S3_ENDPOINT=https://obs.{region}.myhuaweicloud.com` 及 AK/SK
5. 确保宿主机可 HTTPS 访问 OBS endpoint（VPC 内可使用内网域名）

---

## 本地开发：可选 MinIO

仅本地调试附件时可启用 MinIO profile：

```bash
docker compose -f docker-compose.multiuser.yml --profile local-dev up -d

# env 中使用
# KANNA_S3_ENDPOINT=http://127.0.0.1:9000
# KANNA_S3_REGION=us-east-1
# KANNA_S3_BUCKET=kanna
# KANNA_S3_ACCESS_KEY_ID=kanna
# KANNA_S3_SECRET_ACCESS_KEY=kanna_secret
```

MinIO 控制台：http://127.0.0.1:9001（`kanna` / `kanna_secret`）

---

## 镜像说明

| 项 | 值 |
|----|-----|
| 仓库 | `hilpdocker/kanna` |
| 标签 | `latest`（多架构）/ `amd64` / `arm64` |
| 架构 | `linux/amd64`、`linux/arm64` |
| 基础 | `oven/bun:1.3.5` |
| 端口 | `3210` |
| 内置 | Web UI、`KANNA_DISABLE_SELF_UPDATE=1`、健康检查 |
| 不含 | Claude/Codex CLI、Git、用户项目（需挂载） |

```bash
# 查看多架构 manifest
docker manifest inspect hilpdocker/kanna:latest

# 检查 Bun 版本
docker run --rm --entrypoint bun hilpdocker/kanna:latest --version   # 1.3.5
```

---

## 本地构建（可选）

源码改动或无法访问 Docker Hub 时：

```bash
docker build -t hilpdocker/kanna:local .
export KANNA_IMAGE=hilpdocker/kanna:local
docker compose -f docker-compose.multiuser.yml --profile app up -d --build
```

---

## 华为云 SWR（生产 arm64）

生产服务器为 **linux/arm64** 时，使用时间戳标签构建并推送到 SWR：

```bash
# 默认：linux/arm64 + 时间戳标签（如 20260622-163045）
./scripts/build-swr-image.sh

# 或指定版本名
./scripts/build-swr-image.sh 20260622-163045

# Linux 服务器上若需 sudo
USE_SUDO=1 ./scripts/build-swr-image.sh
```

等价手动步骤：

```bash
VERSION=$(date +%Y%m%d-%H%M%S)
sudo docker buildx build --platform linux/arm64 --provenance=false -t kanna:${VERSION} --load .
sudo docker tag kanna:${VERSION} swr.cn-north-4.myhuaweicloud.com/ptzx-devops/kanna:${VERSION}
sudo docker push swr.cn-north-4.myhuaweicloud.com/ptzx-devops/kanna:${VERSION}
```

生产 compose：

```bash
export KANNA_IMAGE=swr.cn-north-4.myhuaweicloud.com/ptzx-devops/kanna:20260622-163045
docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build
```

| 环境 | 推荐镜像 |
|------|----------|
| 本地 Mac 开发 | `hilpdocker/kanna:local`（本机 `docker build`） |
| 生产 arm64 | `swr.cn-north-4.myhuaweicloud.com/ptzx-devops/kanna:{时间戳}` |

---

## 常用运维

```bash
# 拉取新版本并滚动重启
docker pull hilpdocker/kanna:latest
docker compose -f docker-compose.multiuser.yml --profile app up -d --no-build

# 日志
docker compose -f docker-compose.multiuser.yml --profile app logs -f kanna

# 停止 Kanna 容器
docker compose -f docker-compose.multiuser.yml --profile app stop kanna

# 停止全部（保留数据卷）
docker compose -f docker-compose.multiuser.yml down
```
