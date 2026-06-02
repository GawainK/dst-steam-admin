# DST Steam Admin Design

## Goal

在 `/Users/oukai/personal/dst-steam-admin` 新建一个 Steam 版《饥荒联机版》专用服务器管理项目。服务器通过 Docker 部署，并提供一个本地后台用于查看状态、启动、停止、重启、查看日志、编辑基础配置和模组配置。

## Scope

第一版采用 B 方案：常用管理能力。

包含：

- Docker Compose 部署 DST 专用服务器和管理后台。
- 管理后台查看 Docker 服务状态。
- 管理后台启动、停止、重启服务器。
- 管理后台查看最近日志，并支持自动刷新。
- 管理后台编辑基础服务器配置。
- 管理后台编辑模组配置文件。
- 项目内提供部署说明、目录说明和示例配置。

不包含：

- Web 用户登录和多用户权限系统。
- 多套独立服务器集群管理。
- 白名单、黑名单、备份恢复、定时任务。
- 面向公网的安全加固方案。

## Architecture

项目目录为 `dst-steam-admin/`。

Git 仓库：

- 项目生成后在 `dst-steam-admin/` 内初始化 Git 仓库。
- 远程仓库 `origin` 使用 `https://github.com/GawainK/dst-steam-admin.git`。

技术栈：

- 前端：Vue 3、Vite、TypeScript、Naive UI、lucide-vue-next。
- 后端：Node.js、Express、TypeScript。
- 部署：Docker Compose。
- DST 服务：Steam 版 DST dedicated server 容器。
- 数据：将存档、配置和模组配置挂载到项目内 `data/` 目录。

整体结构：

```text
dst-steam-admin/
  apps/
    web/                 # Vue 管理后台
    api/                 # Express API
  docker/
    dst/                 # DST Dockerfile、启动脚本和配置模板
  data/
    cluster/             # DST 集群配置和存档挂载目录
    mods/                # 模组配置辅助目录
  docs/
    deployment.md        # 部署说明
  docker-compose.yml
  README.md
```

## UI Design

后台采用轻量毛玻璃风格，重点保持运维工具可读性。

- 左侧导航、顶部状态条、状态卡片、配置面板使用半透明背景、细边框和 `backdrop-filter: blur(...)`。
- 背景使用低饱和绿色和蓝色层次，避免干扰表单和日志。
- 日志区域保持深色高对比，不使用透明背景。
- 危险操作使用确认弹窗。
- 主要页面：总览、服务器控制、实时日志、世界配置、模组配置、部署说明。

Naive UI 使用范围：

- `n-layout`、`n-menu`：整体布局和侧边导航。
- `n-card`、`n-grid`、`n-statistic`、`n-tag`：状态信息。
- `n-button`、`n-popconfirm`、`n-modal`：操作和确认。
- `n-form`、`n-input`、`n-input-number`、`n-select`、`n-switch`：配置编辑。
- `n-tabs`、`n-code`、`n-scrollbar`：日志和配置文件编辑。
- `n-message`、`n-notification`：操作反馈。

## Backend API

API 只暴露白名单操作，不提供任意 shell 执行入口。

- `GET /api/server/status`：读取 `docker compose ps` 或容器状态，返回运行状态、容器状态和端口信息。
- `POST /api/server/start`：执行启动动作。
- `POST /api/server/stop`：执行停止动作。
- `POST /api/server/restart`：执行重启动作。
- `GET /api/server/logs?lines=200`：返回最近日志。
- `GET /api/config/server`：读取基础服务器配置。
- `PUT /api/config/server`：写入基础服务器配置。
- `GET /api/config/mods`：读取模组配置文件内容。
- `PUT /api/config/mods`：写入模组配置文件内容。

命令执行模块会将业务动作映射到固定命令：

- `start` -> `docker compose up -d dst-master dst-caves`
- `stop` -> `docker compose stop dst-master dst-caves`
- `restart` -> `docker compose restart dst-master dst-caves`
- `status` -> `docker compose ps --format json`
- `logs` -> `docker compose logs --tail <lines> dst-master dst-caves`

后端运行目录固定为项目根目录，避免命令在任意路径执行。

## Configuration

基础配置由后台表单读写到项目内配置文件，再由 DST 启动脚本同步到 DST 集群目录。

第一版支持字段：

- Steam token。
- 房间名。
- 房间密码。
- 最大人数。
- 游戏模式。
- 是否开启洞穴。
- Master 和 Caves 端口。

模组配置第一版提供文件编辑：

- `dedicated_server_mods_setup.lua`
- `modoverrides.lua`

文件编辑会保留原始文本，避免用不完整的结构化解析破坏 Lua 配置。

## Docker Deployment

`docker-compose.yml` 提供三个主要服务：

- `admin-api`：Express API，挂载 Docker socket 和项目数据目录，用于控制 DST 容器。
- `admin-web`：Vue 前端静态服务。
- `dst-master` / `dst-caves`：DST 专用服务器节点。

DST 数据挂载：

- `./data/cluster:/var/lib/dst/cluster`
- `./data/mods:/var/lib/dst/mods`

端口：

- 后台 Web：`8080`
- API：仅供 Web 容器访问，开发环境可映射到 `3000`
- DST Master UDP：`10999`
- DST Caves UDP：`11000`

## Error Handling

- Docker 命令失败时返回命令类型、退出码和简短错误信息，不暴露敏感配置值。
- Steam token 在前端默认隐藏，后端日志不输出 token。
- 配置写入前做基础校验，例如端口范围、最大人数范围、必填房间名。
- 停止和重启操作在前端二次确认。
- 日志接口限制最大行数，避免一次返回过大内容。

## Testing

后端测试重点：

- Docker 命令白名单映射。
- 状态解析。
- 日志行数限制。
- 基础配置读写。
- 模组配置读写。
- 敏感字段不进入错误响应。

前端验证重点：

- 页面可打开。
- 总览状态渲染。
- 启动、停止、重启按钮调用正确 API。
- 停止和重启有确认弹窗。
- 配置表单能加载、保存并显示反馈。
- 日志页面能刷新并滚动。

## Implementation Notes

- 新项目直接创建在当前目录下的 `dst-steam-admin/`。
- 创建项目后配置 Git remote：`origin -> https://github.com/GawainK/dst-steam-admin.git`。
- 先生成可运行的开发环境，再补 Docker 生产部署。
- 由于当前 `/Users/oukai/personal` 不是 Git 仓库，设计文档无法在当前目录提交。
