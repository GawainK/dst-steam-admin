FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && pnpm install --frozen-lockfile --filter @dst-admin/web...

COPY apps/web apps/web
RUN pnpm --filter @dst-admin/web build

FROM nginx:1.27-alpine
# apache2-utils 提供 htpasswd，用于在启动时按环境变量生成 Basic Auth 凭据文件。
RUN apk add --no-cache apache2-utils
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/web-basic-auth.sh /docker-entrypoint.d/40-basic-auth.sh
RUN chmod +x /docker-entrypoint.d/40-basic-auth.sh
EXPOSE 80
