#!/bin/sh
set -eu

cluster_root="${DST_CLUSTER_ROOT:-/var/lib/dst/cluster}"
mods_root="${DST_MODS_ROOT:-/var/lib/dst/mods}"
install_root="${DST_INSTALL_ROOT:-/opt/dst}"
shard_name="${DST_SHARD:-Master}"
server_port="${DST_SERVER_PORT:-10999}"
skip_update="${DST_SKIP_UPDATE:-0}"

mkdir -p "${cluster_root}/${shard_name}" "${mods_root}" "${install_root}/mods"

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
  exec ./dontstarve_dedicated_server_nullrenderer_x64 \
    -persistent_storage_root "${cluster_root}" \
    -conf_dir "${cluster_root}" \
    -cluster dst-cluster \
    -shard "${shard_name}"
fi

echo "DST binary install failed or produced no server executable."
exit 1
