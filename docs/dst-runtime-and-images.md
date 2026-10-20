# DST 分片监督与预装镜像

本次实现参考了 [LetsStarveTogether 的进程管理](https://github.com/LetsStarveTogether/dst-server/blob/main/crates/dst-server/src/process.rs)与 [superjump22 的镜像构建流程](https://github.com/superjump22/dontstarve-server-docker/blob/main/.github/workflows/build.yml)。保留 Vue/Express 后台、现有接口、洞穴开关和所有数据挂载路径。

## 分片管理

`dst-supervisor.py` 是游戏容器内的轻量进程管理器，仅依赖 Python 标准库；不引入上游 Rust SDK、原生控制协议或新的后台服务。

- 每个启用分片拥有独立进程组、标准输入管道和日志读取器，日志继续以 `[Master]` / `[Caves]` 区分。
- 收到停止信号时，向所有仍运行的分片发送 `c_shutdown(true)`，最多等待 40 秒；超时发送 SIGTERM，再等待 5 秒，最后 SIGKILL 并回收进程。
- 任一必需分片退出，停止其余分片，保留非零退出码；正常停服退出码为 0。不会自动重启单个分片并让两个世界处于不同生命周期。
- `/run/dst/status.json` 原子写入分片 PID、就绪状态、退出码、游戏版本、Build ID 和是否发生强制终止；不写入 Token。
- Docker 健康检查要求所有启用分片都就绪、进程存活、心跳未过期。后台优先使用 Docker Health；旧镜像没有健康检查时保留原来的日志判定。
- 就绪默认匹配 `registered via geo DNS` 或 `Sim paused`。可以在 **dst-server** 环境中配置 `DST_READY_MARKERS`（全体分片）及 `DST_CAVES_READY_MARKERS`（洞穴覆盖），以逗号或换行分隔。健康状态只证明内部就绪，不代表公网可以连接。

`DST_SHUTDOWN_TIMEOUT`（0–45 秒，默认 40）与 `DST_TERMINATE_TIMEOUT`（0–10 秒，默认 5）总计不超过 Compose 的 60 秒停服窗口。状态文件在每次启动重新初始化，不沿用旧分片的就绪缓存。

## 两种镜像模式

| 模式 | 构建目标 | 游戏更新方式 |
| --- | --- | --- |
| 本地源码部署（默认） | `runtime` | 启动时用 SteamCMD 检查/更新；保留 `DST_SKIP_UPDATE=1` 对已有安装的离线启动支持 |
| 预装游戏 | `preinstalled` | 构建时下载并验证 Build ID；启动时从镜像同步到原安装卷，不再请求 SteamCMD |

预装版把游戏放在 `/opt/dst-image`，因此原来的 `data/install/master:/opt/dst` 挂载不会遮住镜像内游戏。首次运行或换用不同 Build ID 的镜像时，将游戏同步到安装卷；最后提交 appmanifest，以便中断后重试。数据卷中的 Mod 与存档保留，之后重新渲染用户配置。相同 Build ID 且二进制存在时直接复用。

预装版环境为 `DST_UPDATE_MODE=image`，由所选镜像决定游戏版本；本地版为 `startup`。预装模式不会自动切到 Steam 最新版本，更新通过换镜像并重建游戏容器完成。切回本地模式可以继续使用相同数据目录。

## 自动构建

`.github/workflows/dst-image.yml` 在 main 分支游戏相关代码更新、手动触发，或每半小时检查一次公开游戏 Build ID。GitHub 的调度时间可能延迟；这里只检查和构建镜像，不操作已部署的服务器。

1. 从 `api.steamcmd.net` 读取公开分支元数据，校验数字格式。
2. 组合游戏 Build ID 和源码提交 SHA；该组合镜像已存在时跳过构建。
3. 运行项目测试和类型检查，再通过 SteamCMD 下载游戏；实际安装 Build ID 必须与目标一致，否则构建失败，避免发布错标版本。
4. 仅构建 `linux/amd64` 并推送到 GHCR：
   - `ghcr.io/<owner>/<repo>/dst-server:latest`
   - `:build-<Build ID>`（同一游戏版本可能随项目代码更新而重建）
   - `:build-<Build ID>-<前12位源码SHA>`（用于精确选择游戏与代码组合）

首次使用需要仓库启用 Actions，允许工作流写 Packages；按部署环境需要设置包的可见性或先登录 GHCR。本次只新增工作流文件，未在远端运行或发布。`DST_BUILD_ID` 是校验目标，不是 Steam 历史版本下载参数；若检查与下载之间游戏更新，构建会失败，下一次重新解析最新版本再构建。

## 部署预装版

先按旧版本迁移说明停止旧的双容器（如果还有），然后在 `.env` 添加所需镜像。建议选择完整版本标签或 digest，而不是依赖浮动的 latest：

```dotenv
DST_GAME_IMAGE=ghcr.io/gawaink/dst-steam-admin/dst-server:build-<Build ID>-<源码SHA前12位>
```

```bash
# 先重建后台，使其支持容器健康状态；已有游戏容器暂不受影响
docker compose up -d --build admin-api admin-web
# 拉取并换用游戏镜像，会中断游戏；不删除数据卷
docker compose -f docker-compose.yml -f docker-compose.image.yml pull dst-server
docker compose -f docker-compose.yml -f docker-compose.image.yml up -d --no-build dst-server
docker compose logs -f --tail=100 dst-server
```

本地构建预装版（需要 Docker、Steam 网络与足够磁盘空间）：

```bash
node scripts/dst/image-version.mjs
# 将输出的 buildId 填入下方
docker build --platform linux/amd64 --target preinstalled \
  --build-arg DST_BUILD_ID=<Build ID> \
  -f docker/dst/Dockerfile -t dst-server:preinstalled .
# .env 设置 DST_GAME_IMAGE=dst-server:preinstalled
# 使用上面的双 Compose 文件与 --no-build 启动；本地镜像无需 pull
```

`data/install/caves` 和旧洞穴 SteamCMD 目录仍不主动删除。更新/回退游戏镜像也不等于回退存档；存档恢复继续通过原后台备份功能执行。
