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

- The provided DST image includes config rendering and startup wiring, but it does not yet bundle the actual DST server binary.
- Until the binary is added, the shard containers stay alive with `tail -f /dev/null` so the admin stack, mounts, and config flow can still be verified.
