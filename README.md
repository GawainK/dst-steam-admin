# DST Steam Admin

Steam 版《饥荒联机版》专用服务器本地管理后台。

## Features

- Docker Compose 管理 `dst-server`、`admin-api`、`admin-web`，地面与洞穴在同一游戏容器内运行，共享安装文件
- Express API 提供状态、启停、日志、基础配置、模组配置接口
- Vue 3 + Naive UI 后台提供总览、服务器控制、日志、配置和部署说明面板

## Development

```bash
pnpm install
pnpm dev
```

- API: `http://127.0.0.1:3000`
- Web: `http://127.0.0.1:5173`

## Docker Compose

```bash
docker compose up -d --build
```

容器版后台默认监听 `http://127.0.0.1:8080`。

详细说明见 [docs/deployment.md](docs/deployment.md)。

分片监督、健康检查和轻量运行镜像构建/部署见 [docs/dst-runtime-and-images.md](docs/dst-runtime-and-images.md)。
