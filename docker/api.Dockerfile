FROM docker:28-cli AS dockercli

FROM node:22-bookworm-slim AS base
WORKDIR /app

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN corepack enable && pnpm install --frozen-lockfile --filter @dst-admin/api...

COPY apps/api apps/api
RUN pnpm --filter @dst-admin/api build

EXPOSE 3000
CMD ["pnpm", "--filter", "@dst-admin/api", "start"]
