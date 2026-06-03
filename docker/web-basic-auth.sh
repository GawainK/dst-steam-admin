#!/bin/sh
# 由 nginx 官方镜像的 /docker-entrypoint.d 机制在启动前执行。
# 按环境变量生成 /etc/nginx/.htpasswd 供 Basic Auth 使用。
# 未设置 BASIC_AUTH_PASSWORD 时主动失败，避免把无鉴权的后台暴露到公网。
set -e

: "${BASIC_AUTH_USER:=admin}"

if [ -z "${BASIC_AUTH_PASSWORD:-}" ]; then
  echo >&2 "[basic-auth] 未设置 BASIC_AUTH_PASSWORD，拒绝启动（避免后台无鉴权暴露）。"
  echo >&2 "[basic-auth] 请在部署时设置环境变量，例如在项目根的 .env 中配置 BASIC_AUTH_PASSWORD。"
  exit 1
fi

htpasswd -bc /etc/nginx/.htpasswd "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD" >/dev/null 2>&1
echo "[basic-auth] 已为用户 '$BASIC_AUTH_USER' 生成 /etc/nginx/.htpasswd"
