# Deployment

## Local Development

```bash
pnpm install
pnpm dev
```

API runs on `http://127.0.0.1:3000` and the Vite web app runs on `http://127.0.0.1:5173`.

## Docker Compose

```bash
docker compose up -d --build
docker compose ps
```

Published ports:

- `8080` for the admin web UI
- `3000` for the admin API
- `10999/udp` for the DST master shard
- `11000/udp` for the DST caves shard

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
