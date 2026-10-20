# 服务器更新：切换轻量镜像并更新后台

适用于已使用 `dst-server` 单容器运行地面与洞穴的 Ubuntu x86_64 服务器，项目目录为 `~/dst-steam-admin`，代码分支为 `main`。旧版 `dst-master` / `dst-caves` 双容器部署应先按[完整操作方案](server-operations.md#7-旧版双容器迁移)迁移。

本次使用的轻量镜像：

```text
ghcr.io/gawaink/dst-steam-admin/dst-server:sha-b27bd98d4a47
```

对应源码提交 `b27bd98d4a47f7a3cd384a942412acf535cc4fcb`，已由 [GitHub Actions 构建并发布](https://github.com/GawainK/dst-steam-admin/actions/runs/39376467260)。镜像包含 Steam 库自动修复与洞穴就绪识别修复；后台更新包含首次配置读取修复。后续更新时，应将下方 `dst_new_image` 替换为已发布的目标版本标签。

## 保留的数据与备份范围

更新会暂停游戏与后台，请安排维护时间。容器重新创建后继续使用原来的宿主机目录：

| 路径 | 内容 | 本次处理 |
| --- | --- | --- |
| `.env` | 后台账号密码、镜像标签 | 备份，只修改 `DST_GAME_IMAGE` |
| `docker-compose.yml`、`docker-compose.image.yml` | 部署配置及本地自定义设置 | 备份，通过 Git 快进更新；冲突时停止 |
| `data/cluster` | Steam Token、世界配置、地面与洞穴存档 | 停服后备份，继续挂载原目录 |
| `data/mods` | 合集/模组下载配置与启用配置 | 停服后备份，继续挂载原目录 |
| `data/install/master` | 已安装的游戏及下载的模组文件 | 保留，不纳入此次备份 |
| `data/steamcmd` | SteamCMD 与 Steam 缓存 | 保留，不纳入此次备份 |
| `data/backups` | 已有存档备份 | 保留，不纳入此次备份 |

备份归档保存到仓库外的 `~/dst-private-backups`，其中包含 Token 和后台密码，目录权限为 `700`、归档权限为 `600`。这份归档用于保护配置与存档，不是整个游戏安装目录的快照。

## 执行更新

在服务器上复制执行下面整段命令。需要当前用户可运行 Docker，并具有 `sudo` 权限；`.env` 中应已有可用的后台凭据。若镜像需要鉴权，先通过 `docker login ghcr.io` 登录。

```bash
bash <<'BASH'
set -euo pipefail
cd ~/dst-steam-admin

# 确认在 main 分支，保留服务器上的本地配置修改
if [ "$(git branch --show-current)" != "main" ]; then
  echo "当前不是 main 分支，请先检查，更新已停止。"
  exit 1
fi
test -f .env
git status --short

# 停止服务，让游戏保存并退出
docker compose stop dst-server admin-api admin-web

# 私有备份：包含 Token、后台密码、世界配置、存档及模组配置
dst_backup_dir="$HOME/dst-private-backups"
mkdir -p "$dst_backup_dir"
chmod 700 "$dst_backup_dir"
dst_backup_file="$dst_backup_dir/dst-before-update-$(date +%Y%m%d-%H%M%S).tar.gz"

sudo tar -czf "$dst_backup_file" \
  .env docker-compose.yml docker-compose.image.yml \
  data/cluster data/mods
sudo chown "$(id -u):$(id -g)" "$dst_backup_file"
chmod 600 "$dst_backup_file"
echo "备份完成：$dst_backup_file"

# 更新后台及启动脚本；若本地修改冲突，会停止，不强制覆盖
git pull --ff-only origin main

# 仅更新镜像地址，保留 .env 中原有后台账号密码
dst_new_image='ghcr.io/gawaink/dst-steam-admin/dst-server:sha-b27bd98d4a47'
sed -i -E '/^[[:space:]]*(export[[:space:]]+)?DST_GAME_IMAGE[[:space:]]*=/d' .env
printf '\nDST_GAME_IMAGE=%s\n' "$dst_new_image" >> .env
export DST_GAME_IMAGE="$dst_new_image"

# 拉取已发布的轻量镜像，只构建后台
docker compose \
  -f docker-compose.yml -f docker-compose.image.yml \
  pull dst-server

docker compose build admin-api admin-web

# 使用新镜像重建容器，继续挂载原有 data 目录
docker compose \
  -f docker-compose.yml -f docker-compose.image.yml \
  up -d --no-build admin-api admin-web dst-server

docker compose ps
BASH
```

脚本遇到错误会停止，可能保留在停服状态。先处理错误再重试；若 Git 提示本地修改冲突，检查 `git status --short`，保留运行配置，不要使用 `git reset --hard` 强行覆盖，也不要将含真实 Token 的配置提交到远端。

此流程不会覆盖整份 `.env`、清空 `data` 或在服务器构建游戏镜像。原先手动设置的 `DST_CAVES_READY_MARKERS` 可以保留。启动时会按现有配置检查游戏版本：版本相同则复用安装，版本变化时更新持久化游戏文件；已有 `DST_SKIP_UPDATE` 设置继续生效。

## 更新后验收

```bash
cd ~/dst-steam-admin

# 应输出本次固定版本的镜像标签
docker inspect "$(docker compose ps -q dst-server)" \
  --format '{{.Config.Image}}'

# 等待所有已启用分片就绪
docker compose exec dst-server \
  python3 -m json.tool /run/dst/status.json

# 实时查看游戏启动日志；Ctrl+C 只退出日志查看
docker compose logs -f --tail=100 dst-server
```

启用洞穴时，应满足以下条件：

- 镜像标签以 `:sha-b27bd98d4a47` 结尾；后续更新则核对相应目标版本。
- `overall` 为 `running`，Master 与 Caves 的 `ready` 都为 `true`，容器随后显示 `healthy`。
- 本轮日志出现 `Secondary Caves(2) ready!` 与 `secondary shard LUA is now ready!`，确认分片已连接并就绪。
- 原后台地址与账号密码可用；浏览器强制刷新后，原世界配置、合集/模组配置仍在。
- 玩家连接地面，进入洞穴并返回，确认原世界进度、人物物品和模组功能正常。

新镜像启动分片前会自动同步 SteamCMD 的 64 位 `steamclient.so`。具体同步、备份及回退开关见[启动时修复 Steam Workshop 运行库](dst-runtime-and-images.md#启动时修复-steam-workshop-运行库)。更新失败时的配置与存档恢复见[完整操作方案的备份恢复章节](server-operations.md#10-备份恢复和整机迁移)；仅回退镜像不会回退已更新的游戏文件或存档。
