# 饥荒联机服务器完整操作方案

适用环境：Ubuntu 22.04 / 24.04、x86_64 云服务器，地面与洞穴运行在同一个 `dst-server` 容器中，保留现有 Vue / Express 管理后台。

架构基线：`39ba0d5`（合并地面洞穴进程管理）；本文已按轻量运行镜像与服务器持久化安装方案更新，整理日期：2026-10-20。

> 镜像只包含运行依赖与脚本。游戏首次启动时安装到服务器的 `data/install/master`，后续启动按 Steam 公开分支 Build ID 检查更新。下列操作是部署与验收流程，不代表真实服务器已经验收；使用远端轻量镜像前需要先确认其已发布。

## 目录

1. [准备服务器和网络](#1-准备服务器和网络)
2. [准备最新代码](#2-准备最新代码)
3. [安装并启动 Docker](#3-安装并启动-docker)
4. [启动后台并填写配置](#4-启动后台并填写配置)
5. [准备首次洞穴地图配置](#5-准备首次洞穴地图配置)
6. [构建游戏镜像与首次验收](#6-构建游戏镜像与首次验收)
7. [旧版双容器迁移](#7-旧版双容器迁移)
8. [日常启停和配置修改](#8-日常启停和配置修改)
9. [更新后台与游戏镜像](#9-更新后台与游戏镜像)
10. [备份、恢复和整机迁移](#10-备份恢复和整机迁移)
11. [故障排查与上线检查](#11-故障排查与上线检查)

除明确标为“本地电脑”的操作外，命令均在服务器执行。项目目录统一使用 `~/dst-steam-admin`；示例中的服务器 IP、账号、密码和镜像版本需要替换为自己的值。已有旧版双容器的服务器应先阅读第 7 节，再更新代码。

## 1. 准备服务器和网络

使用 Ubuntu 22.04 或 24.04 的 x86_64 系统；游戏服务的 Compose 平台固定为 `linux/amd64`。无需在宿主机安装 Node.js 或 pnpm 来运行默认容器部署。

游戏安装、Docker 镜像、构建缓存和备份都会占用磁盘，不能只按游戏安装大小预留空间。开始前检查：

```bash
uname -m
free -h
df -h
```

云服务器安全组配置：

| 端口 | 用途 | 建议访问范围 |
| --- | --- | --- |
| TCP 22 | SSH 管理 | 你的管理 IP |
| UDP 10999 | 地面游戏连接 | 玩家来源 |
| UDP 11000 | 洞穴游戏连接 | 玩家来源 |
| TCP 8080 | 管理后台 | 优先通过 SSH 隧道访问，不对公网开放 |
| TCP 3000 | 内部控制 API | 不对公网开放；项目仅绑定宿主机回环地址 |

公网访问限制以云安全组为准。Docker 发布的端口可能绕过部分 UFW 规则，不能只依赖 UFW。参见 [Docker 官方防火墙说明](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)。

## 2. 准备最新代码

在**本地电脑的项目目录**推送已确认的代码：

```bash
git push origin main
```

GitHub Actions 工作流仅手动触发，推送代码不会自动构建；此前禁用的远端工作流保持禁用。工作流只发布轻量运行镜像，不下载游戏。本文的源码部署流程不依赖远端镜像发布。

从本地电脑登录服务器：

```bash
ssh ubuntu@服务器IP
```

新服务器下载项目：

```bash
sudo apt update
sudo apt install -y git ca-certificates curl

git clone https://github.com/GawainK/dst-steam-admin.git ~/dst-steam-admin
cd ~/dst-steam-admin
git log -1 --oneline
git merge-base --is-ancestor 39ba0d5 HEAD
```

最后一条命令退出码为 0，表示服务器代码包含本文基线提交。仓库为私有时，先按现有 GitHub 访问方式完成授权。

## 3. 安装并启动 Docker

新 Ubuntu 服务器可使用仓库的初始化脚本：

```bash
cd ~/dst-steam-admin
TARGET_USER="$(id -un)" bash scripts/init-tencent-lighthouse.sh
sudo systemctl enable --now docker
```

脚本安装 Docker Engine、Buildx 和 Compose Plugin，并把当前用户加入 Docker 用户组。已有可用 Docker 的服务器可以跳过安装。官方安装方式见 [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)。

脚本会先移除已安装的发行版冲突包，再安装 Docker 官方版本；不会清空 Docker 数据。如果安装已因 `docker-compose-v2` 文件覆盖冲突中断，先执行 [安装中断后的修复](tencent-cloud-lighthouse-init-script.md#安装中断后的修复)，再继续验证 Docker。

退出 SSH 后重新登录，使用户组权限生效，再检查：

```bash
docker version
docker compose version
docker run --rm hello-world
df -h
```

`docker version` 应同时显示客户端和服务端信息，而不仅是客户端版本。

## 4. 启动后台并填写配置

### 4.1 配置后台鉴权

仅首次部署且尚无 `.env` 时复制示例，避免覆盖已有凭据：

```bash
cd ~/dst-steam-admin
if [ ! -f .env ]; then
  cp .env.example .env
fi
nano .env
```

填写自己的账号和密码：

```dotenv
BASIC_AUTH_USER=admin
BASIC_AUTH_PASSWORD='替换成足够长的随机密码'
```

单引号可避免密码中的 `$` 被 Compose 当作变量替换；不要在 `.env` 中保留示例密码。参见 [Compose 环境变量插值规则](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。

先只启动后台服务，游戏服此时尚不启动：

```bash
chmod 600 .env
docker compose config --quiet
docker compose up -d --build admin-api admin-web
docker compose ps
```

### 4.2 通过 SSH 隧道访问

在**本地电脑另开终端**，保持下面的会话运行：

```bash
ssh -N -L 18080:127.0.0.1:8080 ubuntu@服务器IP
```

本地浏览器访问 `http://127.0.0.1:18080`，使用 `.env` 中的后台凭据登录。

### 4.3 保存世界配置

在后台“世界配置”填写并保存：

- 自己的 Steam Token：从 [Klei 服务器管理页面](https://accounts.klei.com/account/game/servers?game=DontStarveTogether)生成。
- 房间名和房间密码。
- 最大人数和游戏模式。
- 是否开启洞穴。

端口保持当前的 `10999` 和 `11000`。按需在“模组配置”添加 Workshop ID，在管理员面板添加自己的 Klei 用户 ID。

配置会写入 `data/cluster/admin/server-config.json` 和 `data/mods/`。这些配置源文件目前被 Git 跟踪，日常保存后可能出现在 `git status` 中；不要把包含真实 Token 的配置提交到远端。

## 5. 准备首次洞穴地图配置

当前程序会按开关启动 Caves 分片，但不会自动创建洞穴世界生成文件。

如果已经从游戏客户端导出 `Caves/leveldataoverride.lua`，直接使用该文件。新服没有世界生成配置时，可执行以下命令；它不会覆盖已有配置：

```bash
cd ~/dst-steam-admin

caves_dir="data/cluster/DoNotStarveTogether/Cluster/Caves"
mkdir -p "$caves_dir"

if [ ! -f "$caves_dir/leveldataoverride.lua" ] &&
   [ ! -f "$caves_dir/worldgenoverride.lua" ]; then
  cat > "$caves_dir/worldgenoverride.lua" <<'LUA'
return {
    override_enabled = true,
    preset = "DST_CAVE",
}
LUA
fi
```

`DST_CAVE` 是 Klei 给出的洞穴生成预设，参见 [Klei 世界生成配置说明](https://kleiforums.com/forums/topic/53014-worldgenoverridelua-with-the-new-post-caves-settings/)。

该配置影响新世界生成，不会把已经生成的地面存档自动转换为洞穴。已有存档应先备份，不要删除世界目录来尝试修复。

## 6. 构建游戏镜像与首次验收

### 6.1 构建和启动

```bash
cd ~/dst-steam-admin
docker compose build dst-server
docker compose up -d dst-server
docker compose logs -f --tail=100 dst-server
```

默认构建目标为 `runtime`，游戏首次启动时由 SteamCMD 下载。首次启动耗时取决于网络、磁盘和 Mod 数量。`Ctrl+C` 只退出日志查看，不会停止容器。

### 6.2 检查分片健康状态

```bash
docker compose ps

docker compose exec dst-server \
  python3 -m json.tool /run/dst/status.json
```

启用洞穴后，状态应包含以下内容。下面是省略其他字段的示意，不是完整实际输出：

```json
{
  "overall": "running",
  "shards": [
    { "name": "Master", "ready": true },
    { "name": "Caves", "ready": true }
  ]
}
```

实际文件还包含 PID、退出码、游戏版本、Build ID、心跳时间及 `forced`。关闭洞穴时只要求 Master 就绪。

新版监督器在每次启动分片前同步 SteamCMD 的 64 位 `steamclient.so`，处理已验证的 Workshop 模组下载问题；相同文件会跳过，游戏更新后会重新应用。备份、离线行为和回退开关见 [启动时修复 Steam Workshop 运行库](dst-runtime-and-images.md#启动时修复-steam-workshop-运行库)。洞穴日志已完成 Lua 就绪但状态仍为 `false` 的旧镜像，可按 [洞穴就绪识别](dst-runtime-and-images.md#旧镜像的洞穴就绪识别)配置临时标记，或切换到已修复的新镜像。

### 6.3 从玩家侧验收

1. 等待容器显示 `healthy`，所有启用分片均为 `ready: true`。
2. 从外网客户端搜索房间，或在游戏控制台连接地面：

   ```lua
   c_connect("服务器IP", 10999, "房间密码")
   ```

3. 进入洞穴，再返回地面，确认实际跨分片可用。
4. 记录人物物品与世界进度，通过后台重启，再连接确认进度保留。
5. 正常停服后检查 `forced`，不应依赖强制结束。容器已停止时，可以在宿主机读取最后一次状态：

   ```bash
   docker cp "$(docker compose ps -a -q dst-server):/run/dst/status.json" /tmp/dst-last-status.json
   cat /tmp/dst-last-status.json
   ```

内部健康检查通过仍不能代替公网连接和洞穴往返测试。

## 7. 旧版双容器迁移

本节仅适用于仍运行 `dst-master`、`dst-caves` 的旧环境；新部署直接跳过。

### 7.1 先停服，后更新代码

在旧 Compose 文件仍存在时执行：

```bash
cd ~/dst-steam-admin
docker compose stop dst-master dst-caves
```

确认旧分片停止，再创建一份私有迁移备份：

```bash
dst_backup_dir="$HOME/dst-private-backups"
mkdir -p "$dst_backup_dir"
chmod 700 "$dst_backup_dir"
dst_backup_file="$dst_backup_dir/dst-migration-$(date +%Y%m%d-%H%M%S).tar.gz"

sudo tar -czf "$dst_backup_file" .env data/cluster data/mods
sudo chown "$(id -u):$(id -g)" "$dst_backup_file"
chmod 600 "$dst_backup_file"
```

归档包含 Token、后台密码、世界存档及配置，应作为私有凭据保存。它不包含游戏安装文件，游戏可以重新安装。

### 7.2 更新并切换

```bash
git status --short
git pull --ff-only origin main

docker compose up -d --build --remove-orphans \
  admin-api admin-web dst-server

docker compose logs -f --tail=100 dst-server
```

如果 `git pull` 因本地配置修改而失败，先保留配置并处理冲突，不要执行 `git reset --hard`。只在更新成功后继续后面的启动操作。

新服务复用原来的地面、洞穴存档和 Mod 配置，以及原地面的游戏安装、SteamCMD 目录。`--remove-orphans` 清理旧容器，不删除宿主机数据目录。迁移验收完成前保留旧洞穴安装目录，不主动清理。

若代码已经更新，旧服务名无法再通过新 Compose 文件停止，先用 `docker ps -a` 查明旧容器的确切名称并停止它们；确认停止前不要启动新游戏容器，避免并发写同一存档。

## 8. 日常启停和配置修改

所有命令在 `~/dst-steam-admin` 执行：

| 操作 | 命令 |
| --- | --- |
| 启动已创建的游戏容器 | `docker compose start dst-server` |
| 保存并停止两个分片 | `docker compose stop dst-server` |
| 重启两个分片 | `docker compose restart dst-server` |
| 查看所有容器状态 | `docker compose ps -a` |
| 查看游戏日志 | `docker compose logs -f --tail=100 dst-server` |
| 查看 API 日志 | `docker compose logs --tail=100 admin-api` |
| 查看后台日志 | `docker compose logs --tail=100 admin-web` |

`start` 仅用于启动已经创建的容器；首次创建使用 `up -d`。日常停服由监督器先向各分片发送保存退出命令，超时后才逐级终止；不要用 `docker compose kill` 代替正常停服。

房间配置、Mod 和洞穴开关修改后需要重启游戏容器。关闭洞穴不会删除洞穴存档。世界生成参数与新世界生成有关，不保证修改后能改变已有世界。

### 跳过已有游戏安装的更新检查

默认源码部署模式下，启动或重启会检查游戏更新。需要临时跳过已有安装的更新检查时，在 `docker-compose.yml` 的 `dst-server.environment` 中增加：

```yaml
DST_SKIP_UPDATE: "1"
```

然后重新创建游戏容器：

```bash
docker compose up -d dst-server
```

单纯 `restart` 不会加载修改后的 Compose 环境变量。此选项只适用于已有安装，不会使首次下载离线完成；恢复正常更新时移除该变量并再次 `up -d`。

### 宿主机重启后的恢复

当前 Compose 没有配置自动重启策略。宿主机重启后应检查并启动服务，不要假设容器会自动恢复：

```bash
cd ~/dst-steam-admin
docker compose start
docker compose ps
```

## 9. 更新后台与游戏镜像

更新前检查 `git status --short` 并处理运行配置改动。涉及游戏版本、Mod 或容器变更时，安排维护时间，先停服并备份。

### 9.1 仅更新后台

```bash
cd ~/dst-steam-admin
git pull --ff-only origin main
docker compose up -d --build admin-api admin-web
```

该命令不重建游戏容器。前端更新后在浏览器强制刷新。修改 `.env` 中的后台密码时，重新创建 `admin-web` 使其生效。

### 9.2 更新源码版游戏容器

修改了游戏启动脚本、模板、监督器，或需要构建新版运行环境时：

```bash
git pull --ff-only origin main
docker compose up -d --build dst-server
docker compose logs -f --tail=100 dst-server
```

只更新游戏本身、启动脚本未变化时，重启即可触发 SteamCMD 版本检查，无需重建镜像：

```bash
docker compose restart dst-server
```

这两种操作都会中断玩家连接。游戏安装位于持久化目录，不因容器重建而主动清空；实际是否下载更新取决于 Steam 版本检查结果。

### 9.3 使用已发布的轻量运行镜像

需要同时更新后台、切换已发布镜像并保留现有配置、模组和存档时，可直接按[服务器更新命令](server-update.md)执行；其中包含停服备份、固定版本切换与更新后验收。

先确认手动运行的 GitHub Actions 已成功发布新版轻量镜像；仅有工作流文件或本地提交并不代表镜像已经存在。旧的 `build-*` 预装标签不适用于本方案。完整构建机制见 [分片监督与轻量镜像](dst-runtime-and-images.md)。

在 `.env` 中设置实际存在的完整版本标签，例如：

```dotenv
DST_GAME_IMAGE=ghcr.io/gawaink/dst-steam-admin/dst-server:sha-源码SHA前12位
```

也可以使用镜像 digest。不要把该示例当作已经发布的标签直接拉取。私有镜像先交互式登录：

```bash
docker login ghcr.io -u 你的GitHub用户名
```

先更新后台以支持健康检查，再拉取和切换游戏镜像：

```bash
docker compose up -d --build admin-api admin-web

docker compose -f docker-compose.yml -f docker-compose.image.yml \
  pull dst-server

docker compose -f docker-compose.yml -f docker-compose.image.yml \
  up -d --no-build dst-server

docker compose logs -f --tail=100 dst-server
```

轻量镜像不包含游戏。启动时把游戏安装或更新到原来的服务器目录，继续保留存档和用户 Mod 配置。重建容器时使用两个 Compose 文件以及 `--no-build`。日常后台启停与普通 `start`、`stop`、`restart` 继续操作同一个已创建容器。

游戏更新通过重启时的 SteamCMD 版本检查完成，无需更换镜像；运行中的游戏不会被定时更新。回退镜像只回退运行依赖和管理脚本，不会回退持久化的游戏文件或存档。

## 10. 备份、恢复和整机迁移

### 10.1 日常世界备份

建议每次重要配置、Mod 或游戏版本变更前执行：

1. 后台停止游戏服，确认已经停止。
2. 在“存档备份”创建归档。
3. 下载到本地或其他机器保存。
4. 启动游戏服。

虽然创建备份接口不强制停服，停服后备份可以避免打包过程中世界仍在写入。服务器上的归档保存在 `data/backups/`，需要按实际容量手动保留和清理。

### 10.2 完整备份范围

面板备份打包运行中的 Cluster 目录，排除 `cluster_token.txt`；后台配置源文件、Mod 源文件和 `.env` 不在该范围中。

| 数据 | 位置 | 面板世界备份是否包含 |
| --- | --- | --- |
| 地面、洞穴世界及运行配置 | `data/cluster/DoNotStarveTogether/Cluster/` | 包含，排除 Token 文件 |
| 后台世界配置与 Token | `data/cluster/admin/server-config.json` | 不包含 |
| Mod 源配置 | `data/mods/` | 不包含；Cluster 中已有的分片副本会随世界打包 |
| 后台密码、运行镜像引用 | `.env` | 不包含 |
| 世界备份归档 | `data/backups/` | 需要单独转存 |

运行配置中包含管理员名单、各分片的配置文件等。完整迁移可以按第 7 节的私有归档命令备份 `.env`、`data/cluster` 与 `data/mods`，并单独转存 `data/backups`；无需把可重新安装的游戏文件当作唯一恢复来源。

### 10.3 恢复世界存档

1. 停服并确认状态已停止。
2. 在备份面板选择正确归档并恢复。
3. 确认后台世界配置、Token 与 Mod 源配置正确。
4. 启服，验证地面、洞穴、人物物品和世界进度。

恢复会替换当前世界内容，保留当前磁盘 Token。启动脚本随后会重新渲染配置，因此不能只恢复世界文件却遗漏对应的后台配置源文件。

### 10.4 整机迁移或灾难恢复

1. 在目标机器安装 Docker，部署与备份匹配的代码或镜像。
2. 在游戏容器启动前恢复私有配置和世界数据，确认文件权限允许容器读写。
3. 需要通过后台恢复的归档放入目标服务器的 `data/backups/`，启动后台后按上一节恢复。
4. 新建服务器时检查 Token、后台密码、镜像引用和云安全组；不要继续使用示例凭据。
5. 新旧机器不要同时运行同一份世界；启动目标游戏服后重新执行第 6 节验收。

备份演练应使用独立测试环境，避免把正式世界当作恢复测试目标。

## 11. 故障排查与上线检查

### 11.1 收集状态

```bash
cd ~/dst-steam-admin
docker compose ps -a
docker compose logs --tail=200 dst-server
docker compose logs --tail=100 admin-api admin-web

df -h
free -h
docker stats --no-stream
```

容器仍在运行时可以查看分片状态：

```bash
docker compose exec dst-server \
  python3 -m json.tool /run/dst/status.json
```

### 11.2 按现象排查

| 现象 | 优先检查 |
| --- | --- |
| Docker 命令连不上服务端 | Docker 服务状态、当前用户组权限 |
| 后台无法启动 | `.env` 中的密码、端口占用、`admin-web` 日志 |
| API 启停操作报错 | `admin-api` 日志、Docker socket 挂载和权限 |
| 游戏长时间启动中 | SteamCMD 下载、网络错误、Mod 加载及各分片就绪标记 |
| 只有 Master 就绪 | `[Caves]` 日志、洞穴地图配置、Mod 错误 |
| 房间无法连接 | 客户端与服务端版本、Token、云安全组 UDP 规则 |
| 容器突然退出 | 监督器记录的退出码、内存、磁盘空间 |
| 进入“洞穴”却出现地面 | 洞穴生成预设、是否已经生成了错误世界 |
| 修改配置后无变化 | 是否保存成功，是否重启了正确的游戏容器 |
| 运行镜像拉取失败 | 标签是否存在、GHCR 可见性、登录凭据及网络 |

`unhealthy` 时先找原因，不要仅修改就绪标记让状态变绿。确实因日志措辞不同需要调整时，新镜像应在 `dst-server.environment` 设置 `DST_READY_MARKERS`，洞穴可以通过 `DST_CAVES_READY_MARKERS` 单独覆盖；修改后重新创建游戏容器。仅无健康检查的旧镜像才使用 `admin-api` 的日志标记配置。

### 11.3 上线验收清单

- [ ] 后台可以通过授权访问方式登录，启停操作正常。
- [ ] 地面与洞穴均就绪，容器显示 `healthy`。
- [ ] 外网玩家可以连接，能从地面进入洞穴并返回。
- [ ] 重启后人物和世界进度保留。
- [ ] 正常停服完成保存退出，没有依赖强制结束。
- [ ] 世界归档和私有配置都已有异地备份。
- [ ] 已在独立测试环境完成一次恢复演练。

## 相关文档

- [部署说明](deployment.md)
- [分片监督与轻量镜像](dst-runtime-and-images.md)
- [腾讯云轻量服务器部署](tencent-cloud-lighthouse.md)
- [Ubuntu 初始化脚本说明](tencent-cloud-lighthouse-init-script.md)
