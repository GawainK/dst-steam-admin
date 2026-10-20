# DST 分片监督与轻量镜像

本次实现参考了 [LetsStarveTogether 的进程管理](https://github.com/LetsStarveTogether/dst-server/blob/main/crates/dst-server/src/process.rs)与 [superjump22 的镜像构建流程](https://github.com/superjump22/dontstarve-server-docker/blob/main/.github/workflows/build.yml)。保留 Vue/Express 后台、现有接口、洞穴开关和所有数据挂载路径。

## 分片管理

`dst-supervisor.py` 是游戏容器内的轻量进程管理器，仅依赖 Python 标准库；不引入上游 Rust SDK、原生控制协议或新的后台服务。

- 每个启用分片拥有独立进程组、标准输入管道和日志读取器，日志继续以 `[Master]` / `[Caves]` 区分。
- 收到停止信号时，向所有仍运行的分片发送 `c_shutdown(true)`，最多等待 40 秒；超时发送 SIGTERM，再等待 5 秒，最后 SIGKILL 并回收进程。
- 任一必需分片退出，停止其余分片，保留非零退出码；正常停服退出码为 0。不会自动重启单个分片并让两个世界处于不同生命周期。
- `/run/dst/status.json` 原子写入分片 PID、就绪状态、退出码、游戏版本、Build ID 和是否发生强制终止；不写入 Token。
- Docker 健康检查要求所有启用分片都就绪、进程存活、心跳未过期。后台优先使用 Docker Health；旧镜像没有健康检查时保留原来的日志判定。
- 就绪默认匹配 `registered via geo DNS` 或 `Sim paused`；洞穴还识别 `[Shard] secondary shard LUA is now ready!`，兼容只输出分片 Lua 就绪日志的游戏版本。可以在 **dst-server** 环境中配置 `DST_READY_MARKERS`（全体分片）及 `DST_CAVES_READY_MARKERS`（洞穴覆盖），以逗号或换行分隔；显式配置会覆盖对应默认规则。健康状态只证明内部就绪，不代表公网可以连接。

`DST_SHUTDOWN_TIMEOUT`（0–45 秒，默认 40）与 `DST_TERMINATE_TIMEOUT`（0–10 秒，默认 5）总计不超过 Compose 的 60 秒停服窗口。状态文件在每次启动重新初始化，不沿用旧分片的就绪缓存。

### 旧镜像的洞穴就绪识别

如果日志已出现 `Secondary Caves(2) ready!` 和 `[Shard] secondary shard LUA is now ready!`，但 `Caves.ready` 仍为 `false`，可在现有 `docker-compose.yml` 的 `dst-server.environment` 下加入：

```yaml
DST_CAVES_READY_MARKERS: "[Shard] secondary shard LUA is now ready!"
```

使用已发布镜像时执行下面的命令应用配置，会重新创建并重启游戏容器，沿用原游戏安装和存档：

```bash
docker compose -f docker-compose.yml -f docker-compose.image.yml up -d --no-build dst-server
docker compose exec dst-server python3 -m json.tool /run/dst/status.json
docker compose ps dst-server
```

等待两侧完成初始化后，`Master.ready` 与 `Caves.ready` 应同时为 `true`、`overall` 为 `running`，Docker 健康状态会在后续探测中变为 `healthy`。这里只识别完整的 Lua 就绪标记；`secondary shard is now ready!` 这条较早的握手日志不作为新增标记。

## 轻量镜像与服务器安装目录

镜像只包含 Debian 运行依赖、Python 监督器、配置模板和启动脚本，不包含游戏文件，也不在构建阶段运行 SteamCMD。地面和洞穴仍在同一个 `dst-server` 容器中，共用服务器上的一份游戏安装。

| 服务器目录（项目根目录下） | 容器目录 | 用途 |
| --- | --- | --- |
| `data/install/master` | `/opt/dst` | 游戏程序、版本清单和下载的 Mod |
| `data/steamcmd/master` | `/opt/steamcmd` | SteamCMD 客户端及更新缓存 |
| `data/steamcmd/master-home` | `/root/Steam` | Steam 客户端运行数据 |
| `data/cluster` | `/var/lib/dst/cluster` | 后台配置、Token、地面与洞穴存档 |
| `data/mods` | `/var/lib/dst/mods` | 用户 Mod 配置 |

这些都是宿主机的目录挂载，容器重建后继续复用。`.dockerignore` 排除了 `data/`，本地游戏安装和存档不会进入构建上下文。轻量化减少镜像传输和构建占用，服务器仍需为游戏安装、Mod 和备份预留磁盘空间。

## 首次安装与后续更新

每次启动 `dst-server` 时，监督器先运行安装器，成功后再启动启用的分片：

1. 首次启动：下载 SteamCMD 到持久化目录，通过 Steam 安装公开分支游戏到 `data/install/master`。
2. 后续启动：读取本地 `steamapps/appmanifest_343050.acf` 中的 Build ID，并查询 Steam 公开分支 Build ID。
3. 版本相同且游戏可执行文件存在：跳过游戏下载，继续同步运行库和渲染配置后启动分片。
4. 版本不同、清单无法确认或可执行文件缺失：调用 SteamCMD 执行安装/更新。安装失败时不启动分片，保留错误供后台和日志检查。

运行中的服务器不会被后台定时更新。需要更新游戏时，先安排维护并备份，再通过后台重启，或执行：

```bash
docker compose restart dst-server
docker compose logs -f --tail=100 dst-server
```

游戏版本更新不需要重建镜像。已有安装需要临时离线启动时，可在 `dst-server.environment` 中设置 `DST_SKIP_UPDATE: "1"` 并重新创建容器；恢复正常版本检查时移除此配置。无游戏安装时仍会尝试首次下载。

### 启动时修复 Steam Workshop 运行库

每次启动时，在安装/更新结束后、两个分片启动前，监督器会将服务器持久化的 `/opt/steamcmd/linux64/steamclient.so` 同步到 `/opt/dst/bin64/lib64/steamclient.so`。这对应已验证的 Workshop 旧版模组下载修复：此前出现 `Install library folder not found` 和 `OnDownloadPublishedFile [16]`，同步后本次合集的 15 个模组均通过地面与洞穴的加载检查。

- `DST_SKIP_UPDATE=1` 只跳过已有游戏的联网更新检查，本地运行库同步仍执行。
- 文件内容相同时跳过复制。游戏更新覆盖运行库、或 SteamCMD 更新运行库后，下次启动会重新同步。
- 替换前把原文件保存到同目录 `steamclient.so.before-steamcmd`；只保留最近一次替换前的备份，相同文件不会改写备份。
- 复制通过同目录临时文件和原子替换完成；源文件必须具有 ELF x86-64 标识，32 位或文件头不完整的源文件会让启动失败并保留原库。SteamCMD 的 64 位库不存在时会记录提示并保留当前库，兼容已有离线安装。

需要回退时，先停止游戏服，在 `dst-server.environment` 中设置 `DST_SKIP_STEAM_LIBRARY_SYNC: "1"`，将备份还原到 `steamclient.so`，然后按当前使用的 Compose 文件重新创建容器使环境变量生效。恢复自动修复时移除此开关。只还原备份而不关闭同步，下次启动仍会再次应用 SteamCMD 库。

同步只处理服务器挂载目录中的运行库，镜像仍仅包含运行依赖与脚本。新镜像成功发布后，通过修改 `.env` 中的 `DST_GAME_IMAGE`、拉取镜像并使用两个 Compose 文件与 `--no-build` 重建游戏容器即可应用。

## 本地构建与部署（默认）

```bash
# 只构建依赖和脚本，不下载游戏
docker compose build dst-server
# 首次启动时下载到服务器目录；已有安装按版本检查更新
docker compose up -d dst-server
docker compose logs -f --tail=100 dst-server
```

后台仍通过原有 API 控制同一个容器。已有服务器可以直接 `docker compose up -d --build dst-server` 切换，继续使用原安装、Mod 和存档；无需删除 `data/` 或重新生成世界。旧的 `DST_UPDATE_MODE` / `DST_IMAGE_ROOT` 已不再参与运行逻辑，可以从自定义配置中移除。`data/install/caves` 和旧洞穴 SteamCMD 目录不主动删除。

## 可选的 GitHub Actions 构建

`.github/workflows/dst-image.yml` 仅保留手动触发；没有定时任务，也不随代码推送自动构建。需要发布时，先推送待构建的提交，再从 Actions 手动运行 `main`；工作流如果处于禁用状态，需要先启用。构建不会自动部署到服务器。

工作流运行项目测试与类型检查，只构建 `runtime` 目标的 `linux/amd64` 镜像并推送 GHCR：

- `ghcr.io/<owner>/<repo>/dst-server:latest`
- `ghcr.io/<owner>/<repo>/dst-server:sha-<源码SHA前12位>`

构建不查询游戏版本，也不下载游戏。镜像标签表示运行脚本版本，与服务器上的游戏 Build ID 独立。首次发布需要允许工作流写 Packages，并按部署环境设置包可见性或登录 GHCR。

## 拉取轻量镜像部署

确认新版轻量镜像已经发布后，在 `.env` 设置实际存在的标签或 digest。旧的 `build-*` 预装标签不适用于本方案：

```dotenv
DST_GAME_IMAGE=ghcr.io/gawaink/dst-steam-admin/dst-server:sha-<源码SHA前12位>
```

```bash
# 更新后台
docker compose up -d --build admin-api admin-web
# 拉取并切换运行镜像；游戏依然下载/更新到服务器目录
docker compose -f docker-compose.yml -f docker-compose.image.yml pull dst-server
docker compose -f docker-compose.yml -f docker-compose.image.yml up -d --no-build dst-server
docker compose logs -f --tail=100 dst-server
```

后续重建已拉取镜像的容器时，继续使用两个 Compose 文件与 `--no-build`。后台启停及普通 `start` / `stop` / `restart` 操作同一个已创建容器。

回退运行镜像只回退依赖和管理脚本，不会回退服务器上的游戏文件或存档；下一次正常启动仍检查 Steam 公开分支。存档恢复继续通过原后台备份功能执行。
