#!/bin/sh
set -eu

read_json_string() {
  file_path="$1"
  key="$2"

  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "${file_path}" | head -n 1
}

read_json_scalar() {
  file_path="$1"
  key="$2"

  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\\([^,}]*\\).*/\\1/p" "${file_path}" | head -n 1 | tr -d ' "'
}

cluster_root="${DST_CLUSTER_ROOT:-/var/lib/dst/cluster}"
mods_root="${DST_MODS_ROOT:-/var/lib/dst/mods}"
install_root="${DST_INSTALL_ROOT:-/opt/dst}"
template_root="${DST_TEMPLATE_ROOT:-/opt/dst-templates}"
shard_name="${DST_SHARD:-Master}"
config_file="${cluster_root}/admin/server-config.json"
cluster_name="${DST_CLUSTER_NAME:-}"
cluster_password="${DST_CLUSTER_PASSWORD:-}"
game_mode="${DST_GAME_MODE:-}"
max_players="${DST_MAX_PLAYERS:-}"
server_port="${DST_SERVER_PORT:-}"
steam_token="${DST_STEAM_TOKEN:-}"

if [ -f "${config_file}" ]; then
  [ -n "${cluster_name}" ] || cluster_name="$(read_json_string "${config_file}" "clusterName")"
  [ -n "${cluster_password}" ] || cluster_password="$(read_json_string "${config_file}" "clusterPassword")"
  [ -n "${game_mode}" ] || game_mode="$(read_json_string "${config_file}" "gameMode")"
  [ -n "${max_players}" ] || max_players="$(read_json_scalar "${config_file}" "maxPlayers")"
  [ -n "${steam_token}" ] || steam_token="$(read_json_string "${config_file}" "steamToken")"

  if [ -z "${server_port}" ]; then
    if [ "${shard_name}" = "Master" ]; then
      server_port="$(read_json_scalar "${config_file}" "masterPort")"
    else
      server_port="$(read_json_scalar "${config_file}" "cavesPort")"
    fi
  fi
fi

[ -n "${cluster_name}" ] || cluster_name="DST Steam Admin"
[ -n "${game_mode}" ] || game_mode="survival"
[ -n "${max_players}" ] || max_players="6"
[ -n "${server_port}" ] || server_port="10999"

mkdir -p "${cluster_root}" "${cluster_root}/${shard_name}" "${install_root}/mods"

sed \
  -e "s|{{CLUSTER_NAME}}|${cluster_name}|g" \
  -e "s|{{CLUSTER_PASSWORD}}|${cluster_password}|g" \
  -e "s|{{GAME_MODE}}|${game_mode}|g" \
  -e "s|{{MAX_PLAYERS}}|${max_players}|g" \
  "${template_root}/cluster.ini.template" > "${cluster_root}/cluster.ini"

sed \
  -e "s|{{SERVER_PORT}}|${server_port}|g" \
  -e "s|{{IS_MASTER}}|$( [ "${shard_name}" = "Master" ] && echo true || echo false )|g" \
  "${template_root}/server.ini.template" > "${cluster_root}/${shard_name}/server.ini"

if [ -n "${steam_token}" ]; then
  printf '%s\n' "${steam_token}" > "${cluster_root}/cluster_token.txt"
fi

if [ -f "${mods_root}/dedicated_server_mods_setup.lua" ]; then
  cp "${mods_root}/dedicated_server_mods_setup.lua" "${install_root}/mods/dedicated_server_mods_setup.lua"
fi

if [ -f "${mods_root}/modoverrides.lua" ]; then
  cp "${mods_root}/modoverrides.lua" "${cluster_root}/${shard_name}/modoverrides.lua"
fi
