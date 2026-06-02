# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Steam 版《饥荒联机版》（Don't Starve Together）专用服务器的本地管理后台。通过 Web UI 调用 API，API 再调用宿主机的 `docker compose` 来管理 DST 游戏服务器容器（`dst-master`、`dst-caves`）。

## 命令

pnpm workspace monorepo（`apps/*`），需 pnpm 10 / Node 22。

```bash
pnpm install
pnpm dev          # 并行启动 api(:3000) 和 web(:5173)
pnpm build        # 递归构建所有包
pnpm test         # 递归运行所有测试（vitest）
pnpm lint         # 递归类型检查（api: tsc --noEmit, web: vue-tsc）

# 单个包
pnpm --filter @dst-admin/api dev|build|test|lint
pnpm --filter @dst-admin/web dev|build|test|lint

# 运行单个测试文件 / 单个用例
pnpm --filter @dst-admin/api exec vitest run tests/compose.test.ts
pnpm --filter @dst-admin/api exec vitest run -t "用例名片段"

# 整套容器（含 DST 服务器）
docker compose up -d --build
```

## 架构

### 三层结构
- `apps/web` — Vue 3 + Naive UI + Vite 后台界面。组件按面板划分（`AppShell` 内含 `StatusCard`/`ControlPanel`/`LogsPanel`/`ServerConfigForm`/`ModsConfigPanel`/`DocsPanel`）。所有后端调用集中在 `apps/web/src/api/client.ts`，该文件也是前后端共享数据结构的事实定义。
- `apps/api` — Express ESM 服务。`createApp()` 挂载两个路由：`/api/server`（状态/启停/日志）与 `/api/config`（server-config 与 mods 文件）。
- DST 容器 — `docker/dst/` 下的镜像，启动时由 shell 脚本渲染配置并用 SteamCMD 安装游戏服务器。

### API 如何控制游戏服务器
`apps/api/src/docker/compose.ts` 是核心：把动作（`start`/`stop`/`restart`/`status`/`logs`）映射成 `docker compose` 子命令并用 `spawn`（`shell: false`）执行。注意：
- start/stop/restart 只作用于 `dst-master`、`dst-caves` 两个服务，不影响 admin 容器自身。
- 安全约束：`resolveComposeCwd` 强制 compose 的工作目录必须位于项目根之内，否则抛错。
- 容器内通过挂载 `/var/run/docker.sock` 调用宿主机 docker；API 镜像从 `docker:cli` 阶段复制 `docker` 和 `docker-compose` 二进制。

### 配置数据流
- 项目根由 `apps/api/src/config/paths.ts` 通过向上查找 `pnpm-workspace.yaml`/`.git` 标记发现，可用环境变量 `PROJECT_ROOT` 覆盖（Docker 中设为 `/app`）。
- Web 改配置 → API 写入 `data/cluster/admin/server-config.json`（server config，zod 校验见 `config/schema.ts`）与 `data/mods/*.lua`（mod 文件）。
- DST 容器启动时 `docker/dst/render-config.sh` 读取该 JSON（用 sed/grep 解析），结合环境变量渲染 `cluster.ini` / `server.ini` / `cluster_token.txt`，并把 mod 文件拷到游戏目录。`data/` 通过 volume 在 admin-api 与 DST 容器间共享。

### Steam token 处理（易踩坑）
`config/server-config.ts`：读取时 token 永不回传明文，只返回 `steamTokenMasked`，`steamToken` 字段返回空串。写入时若 `steamToken` 为空串，会保留磁盘上已有的 token（避免前端回显空值覆盖掉真实 token）；若磁盘上也没有则抛 ZodError。改这块逻辑时务必保持此行为。

## 约定

- **API 是 ESM**（`"type": "module"`，TS NodeNext）。相对 import 必须带 `.js` 扩展名（如 `import ... from "./service.js"`），即使源文件是 `.ts`。
- **测试位置不统一**：api 测试在 `apps/api/tests/**/*.test.ts`（vitest node 环境）；web 测试与源码同目录 `apps/web/src/**/*.test.ts`（jsdom 环境）。
- api 的 `lint` 即 `tsc --noEmit`，没有 ESLint；web 的 `lint` 是 `vue-tsc --noEmit`。
- Web 开发时 Vite 把 `/api` 代理到 `http://127.0.0.1:3000`；生产由 nginx（`docker/web.nginx.conf`）反代。
- 部分测试直接断言 Dockerfile / nginx 配置 / compose 渲染脚本的内容（`api-dockerfile.test.ts`、`web-nginx.test.ts`、`dst-render.test.ts`），改这些基础设施文件时同步更新对应测试。

## 部署

详见 `docs/deployment.md`；腾讯云轻量服务器一键初始化见 `scripts/init-tencent-lighthouse.sh` 与 `docs/tencent-cloud-lighthouse*.md`。容器版后台默认 `http://127.0.0.1:8080`。首次启动 DST 容器会用 SteamCMD 下载游戏服务端，耗时较长且需 15 GiB+ 磁盘空间。
