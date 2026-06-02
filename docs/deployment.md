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
