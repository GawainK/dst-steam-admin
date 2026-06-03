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
