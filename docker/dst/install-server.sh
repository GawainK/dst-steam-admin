#!/bin/sh
set -eu

app_id=343050
install_root="${DST_INSTALL_ROOT:-/opt/dst}"
steamcmd_root="${DST_STEAMCMD_ROOT:-/opt/steamcmd}"
steamcmd_url="${DST_STEAMCMD_URL:-https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz}"
validate_flag="${DST_VALIDATE_ON_UPDATE:-0}"
install_retry_count="${DST_INSTALL_RETRY_COUNT:-3}"
install_retry_delay="${DST_INSTALL_RETRY_DELAY:-5}"
server_binary="${install_root}/bin64/dontstarve_dedicated_server_nullrenderer_x64"
app_manifest="${install_root}/steamapps/appmanifest_${app_id}.acf"

mkdir -p "${install_root}" "${steamcmd_root}"

# Bootstrap SteamCMD only when it is missing. Persisting ${steamcmd_root} on a volume
# keeps the ~40 MB client self-update from being re-downloaded on every container start.
if [ ! -x "${steamcmd_root}/steamcmd.sh" ]; then
  temp_archive="$(mktemp /tmp/steamcmd.XXXXXX.tar.gz)"
  trap 'rm -f "${temp_archive}"' EXIT INT TERM
  curl -fsSL "${steamcmd_url}" -o "${temp_archive}"
  tar -xzf "${temp_archive}" -C "${steamcmd_root}"
  rm -f "${temp_archive}"
  trap - EXIT INT TERM
fi

# buildid currently installed on disk (empty when the game was never installed).
installed_buildid=""
if [ -f "${app_manifest}" ]; then
  installed_buildid="$(awk '/"buildid"/ { gsub(/[^0-9]/, "", $NF); print $NF; exit }' "${app_manifest}")"
fi

# Latest public buildid reported by Steam (empty when the query fails / offline). This
# is a metadata-only call: it does not download the game, so it is cheap to run on every
# start once SteamCMD itself is persisted.
latest_buildid="$(
  "${steamcmd_root}/steamcmd.sh" \
    +login anonymous \
    +app_info_update 1 \
    +app_info_print "${app_id}" \
    +quit 2>/dev/null \
  | awk '/"public"/ { in_public = 1 } in_public && /"buildid"/ { gsub(/[^0-9]/, "", $NF); print $NF; exit }'
)"

# Skip the download entirely when the server is already installed and on the latest
# public buildid. Only update when the binary is missing, a newer build exists, or the
# versions could not be determined (fail safe toward updating).
if [ -x "${server_binary}" ] \
  && [ -n "${installed_buildid}" ] \
  && [ -n "${latest_buildid}" ] \
  && [ "${installed_buildid}" = "${latest_buildid}" ]; then
  echo "DST already at latest buildid ${installed_buildid}; skipping update."
  exit 0
fi

if [ ! -x "${server_binary}" ]; then
  echo "DST not installed yet; performing first install."
elif [ -n "${installed_buildid}" ] && [ -n "${latest_buildid}" ]; then
  echo "DST update available: installed=${installed_buildid} latest=${latest_buildid}; updating."
else
  echo "Could not determine build ids (installed='${installed_buildid}' latest='${latest_buildid}'); running update to be safe."
fi

attempt=1

while [ "${attempt}" -le "${install_retry_count}" ]; do
  if [ "${validate_flag}" = "1" ]; then
    if "${steamcmd_root}/steamcmd.sh" \
      +force_install_dir "${install_root}" \
      +login anonymous \
      +app_update "${app_id}" validate \
      +quit; then
      exit 0
    fi
  else
    if "${steamcmd_root}/steamcmd.sh" \
      +force_install_dir "${install_root}" \
      +login anonymous \
      +app_update "${app_id}" \
      +quit; then
      exit 0
    fi
  fi

  if [ "${attempt}" -lt "${install_retry_count}" ]; then
    echo "SteamCMD install attempt ${attempt} failed, retrying in ${install_retry_delay}s..."
    sleep "${install_retry_delay}"
  fi

  attempt=$((attempt + 1))
done

echo "SteamCMD install failed after ${install_retry_count} attempts."
exit 1
