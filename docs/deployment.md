# Deployment

## Local Development

```bash
pnpm install
pnpm dev
```

API runs on `http://127.0.0.1:3000` and the Vite web app runs on `http://127.0.0.1:5173`.

## Docker Compose

> ⚠️ 先配置后台鉴权再启动（见下方「后台访问鉴权」），否则 `admin-web` 会拒绝启动。

```bash
cp .env.example .env          # 然后修改 BASIC_AUTH_PASSWORD
docker compose up -d --build
docker compose ps
```

Published ports:

- `8080` for the admin web UI（受 Basic Auth 保护）
- `127.0.0.1:3000` for the admin API（仅本机，不对公网暴露；nginx 经 compose 内网访问）
- `10999/udp` for the DST master shard
- `11000/udp` for the DST caves shard

## 后台访问鉴权（Basic Auth）

后台 UI 与 `/api` 控制接口都由 nginx 的 Basic Auth 保护。凭据通过环境变量注入 `admin-web` 容器，启动时生成 `/etc/nginx/.htpasswd`。

- 在项目根创建 `.env`（参考 `.env.example`）并设置：
  - `BASIC_AUTH_USER`（默认 `admin`）
  - `BASIC_AUTH_PASSWORD`（**必填**）
- 未设置 `BASIC_AUTH_PASSWORD` 时 `admin-web` 会**主动失败退出**，避免无鉴权的后台暴露到公网。
- 修改密码后重建前端使其生效：`docker compose up -d --build admin-web`。

> 安全说明：`admin-api` 挂载了宿主机 Docker socket，拥有较高权限，因此默认只绑定 `127.0.0.1`，不要把 `3000` 改回公网发布。有公网域名时建议在前面再套一层 HTTPS。

## 更新部署（仅前端改动）

后台 UI（`apps/web`）改动后，服务器上只需重建 `admin-web` 一个容器，**不要重建 DST 游戏容器**（重建 `dst-master` / `dst-caves` 会触发 SteamCMD 重新下载、白白重启游戏服）：

```bash
cd ~/dst-steam-admin          # compose 固定项目名，目录约定为 ~/dst-steam-admin
git pull origin main
docker compose up -d --build admin-web   # 仅重建并重启前端（nginx 静态构建，必须 rebuild 才生效）
docker compose ps
```

随后浏览器打开 `http://<服务器IP>:8080/` 并**强制刷新**（`Cmd+Shift+R` / `Ctrl+F5`）清缓存。

- 未改后端 API 时 `admin-api` 无需重建。
- 若 `git pull` 报本地改动冲突，先 `git status` 排查；通常是 `data/` 下的运行时文件（已 gitignore，不应冲突），不要直接 `git reset --hard`。

## 更新部署（前端 + 后端都改动）

当改动同时涉及后台 UI（`apps/web`）与 API（`apps/api`）时，需要重建 `admin-web` 与 `admin-api` **两个后台容器**，但**仍然不要重建 DST 游戏容器**（`dst-master` / `dst-caves`，重建会触发 SteamCMD 重新下载、白白重启游戏服）：

```bash
cd ~/dst-steam-admin
git pull origin main
docker compose up -d --build admin-web admin-api   # 只重建两个后台容器
docker compose ps
```

然后浏览器打开 `http://<服务器IP>:8080/` 并**强制刷新**清缓存。

- 不确定改了哪层时，重建这两个 admin 容器总是安全的；关键是别带上 `dst-master` / `dst-caves`。
- 后台只负责把模组/世界配置写进 `data/` 下的文件；要让 DST 真正加载新配置，需在「总览」点重启，或 `docker compose restart dst-master dst-caves`。
- 模组名称解析需 `admin-api` 能访问 `api.steampowered.com`（结果缓存在 `data/mods/.mod-names.json`）；访问受限时列表降级显示 Workshop ID，不影响其它功能。

## 更新部署（DST 容器的脚本/模板改动）

渲染脚本（`docker/dst/render-config.sh`）和 ini 模板（`cluster.ini.template` / `server.ini.template`）是 **COPY 进 DST 镜像**的，改了它们必须**重建 DST 镜像**才生效：

```bash
cd ~/dst-steam-admin
git pull origin main
docker compose up -d --build dst-master dst-caves
```

- **不会重新下载 15 GB**：游戏本体装在 `./data/install/{master,caves}` 卷上，不在镜像里。重建镜像只重跑很轻的 COPY/apt 层。
- **按版本更新，不每次重下**：`install-server.sh` 启动时用 `app_info_print` 取 Steam 最新 buildid，与本地 `appmanifest` 的 buildid 比对——**相同直接跳过下载**，不同（或没装/查不到）才更新。SteamCMD 自身持久化在 `./data/steamcmd/*`，所以那 ~40MB 客户端也不再每次重下。
- **完全离线/不检查更新**：在对应 DST 服务设 `DST_SKIP_UPDATE: "1"`，启动时只要二进制已存在就完全不跑 SteamCMD（代价：不再自动更新游戏版本，需要时临时去掉该标志重建一次）。
- 会有**几分钟的游戏服断线**（两个分片重建 + 校验期间）。
- 这与前面「仅重启让配置生效」不同：那种只改了 `data/` 下的文件、镜像没变，用 `docker compose restart` 即可；这里改的是镜像内的脚本/模板，必须 `--build`。

### 洞穴（多分片 Shard）

地面（`dst-master`）和洞穴（`dst-caves`）通过 compose 内网在分片端口 `10888/udp` 互联（无需映射到宿主机）。是否启用由后台「世界配置」的**启用洞穴**开关驱动（渲染时读 `enableCaves`，默认开）。

- 两个分片共享同一个 `./data/cluster` 卷，`cluster.ini` 全集群一致；`master_ip` 统一指向 compose 服务名 `dst-master`，洞穴据此找到地面。
- 首次启用洞穴会**新生成洞穴世界**（地面存档保留），洞穴分片首启耗时较长，日志出现 `Shard server mode enabled` / 洞穴世界生成完成即正常。
- 确认互联是否成功：`docker compose logs dst-master | grep -i shard` 应看到分片已启用、副分片已连接的字样，不再是 `Shard server mode disabled by configuration file`。
- 如需关闭洞穴：后台关掉「启用洞穴」并 `docker compose up -d --build dst-master`，同时 `docker compose stop dst-caves`。

## 查看日志

容器日志统一用 `docker compose logs`（在 `~/dst-steam-admin` 目录下执行）。四个服务名：`admin-web`、`admin-api`、`dst-master`、`dst-caves`。

```bash
cd ~/dst-steam-admin

# 看某个服务最近 100 行
docker compose logs --tail=100 dst-master

# 实时跟随（Ctrl+C 退出）
docker compose logs -f dst-master

# 跟随并只保留最近 50 行起步，避免一次刷屏
docker compose logs -f --tail=50 dst-caves

# 同时看所有服务
docker compose logs --tail=100

# 带时间戳
docker compose logs -t --tail=100 dst-master
```

按关键词过滤（排查常见问题）：

```bash
# 服务器是否成功上线/登记（看到 "Online: true" 和 "Server registered" 即正常）
docker compose logs --tail=300 dst-master | grep -iE "online|register|token|E_INVALID"

# 模组加载情况
docker compose logs --tail=300 dst-master | grep -i "mod"

# 后台 API 报错
docker compose logs --tail=200 admin-api | grep -iE "error|warn"

# 前端 nginx / Basic Auth 启动情况
docker compose logs --tail=50 admin-web
```

- 已退出的容器也想看日志：`docker compose logs <服务名>` 仍可读，或 `docker compose ps -a` 先确认状态。
- 后台 UI 的「实时日志」面板看的是 `dst-master`/`dst-caves` 的游戏日志，与上面 `docker compose logs` 等价，排查容器本身（admin-api/admin-web）启动问题时用命令行更全。

## Mounted Data

- `data/cluster` stores generated cluster and shard config files
- `data/mods` stores `dedicated_server_mods_setup.lua` and `modoverrides.lua`

## Notes

- The DST image now includes SteamCMD-based install/update wiring through `docker/dst/install-server.sh`.
- On first startup, the shard containers may spend significant time downloading DST server content before the game server process becomes ready.
- Make sure the target machine has at least `10 GiB+` download headroom and `15 GiB+` free disk space.

## Tencent Cloud Lighthouse

如果你准备部署到腾讯云轻量应用服务器，参考：

- [docs/tencent-cloud-lighthouse.md](/Users/oukai/personal/dst-steam-admin/docs/tencent-cloud-lighthouse.md)
- [docs/tencent-cloud-lighthouse-init-script.md](/Users/oukai/personal/dst-steam-admin/docs/tencent-cloud-lighthouse-init-script.md)
