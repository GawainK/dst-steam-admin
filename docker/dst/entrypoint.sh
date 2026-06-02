#!/bin/sh
set -eu

cluster_root="${DST_CLUSTER_ROOT:-/var/lib/dst/cluster}"
mods_root="${DST_MODS_ROOT:-/var/lib/dst/mods}"
install_root="${DST_INSTALL_ROOT:-/opt/dst}"
shard_name="${DST_SHARD:-Master}"
server_port="${DST_SERVER_PORT:-10999}"
skip_update="${DST_SKIP_UPDATE:-0}"
conf_dir_name="${DST_CONF_DIR:-DoNotStarveTogether}"
cluster_dir_name="${DST_CLUSTER_DIR_NAME:-Cluster}"

mkdir -p "${cluster_root}/${conf_dir_name}/${cluster_dir_name}/${shard_name}" "${mods_root}" "${install_root}/mods"

/usr/local/bin/dst-render-config

if [ "${skip_update}" != "1" ] || [ ! -x "${install_root}/bin64/dontstarve_dedicated_server_nullrenderer_x64" ]; then
  /usr/local/bin/dst-install-server
fi

echo "Starting DST shard ${shard_name} on UDP ${server_port}"
echo "Cluster root: ${cluster_root}"
echo "Mods root: ${mods_root}"
echo "Install root: ${install_root}"

if [ -x "${install_root}/bin64/dontstarve_dedicated_server_nullrenderer_x64" ]; then
  # The dedicated server resolves game data relative to its working directory,
  # so it must be launched from inside bin64 or scripts/main.lua fails to load.
  cd "${install_root}/bin64"
  # -conf_dir / -cluster are path segments DST appends under -persistent_storage_root.
  # They MUST be relative names; passing an absolute path (e.g. the storage root) makes
  # DST concatenate it into a doubled, non-existent path, breaking token/save resolution.
  exec ./dontstarve_dedicated_server_nullrenderer_x64 \
    -persistent_storage_root "${cluster_root}" \
    -conf_dir "${conf_dir_name}" \
    -cluster "${cluster_dir_name}" \
    -shard "${shard_name}"
fi

echo "DST binary install failed or produced no server executable."
exit 1
