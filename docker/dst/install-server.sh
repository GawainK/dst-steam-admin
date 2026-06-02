#!/bin/sh
set -eu

install_root="${DST_INSTALL_ROOT:-/opt/dst}"
steamcmd_root="${DST_STEAMCMD_ROOT:-/opt/steamcmd}"
steamcmd_url="${DST_STEAMCMD_URL:-https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz}"
validate_flag="${DST_VALIDATE_ON_UPDATE:-0}"

mkdir -p "${install_root}" "${steamcmd_root}"

if [ ! -x "${steamcmd_root}/steamcmd.sh" ]; then
  temp_archive="$(mktemp /tmp/steamcmd.XXXXXX.tar.gz)"
  trap 'rm -f "${temp_archive}"' EXIT INT TERM
  curl -fsSL "${steamcmd_url}" -o "${temp_archive}"
  tar -xzf "${temp_archive}" -C "${steamcmd_root}"
  rm -f "${temp_archive}"
  trap - EXIT INT TERM
fi

if [ "${validate_flag}" = "1" ]; then
  "${steamcmd_root}/steamcmd.sh" \
    +force_install_dir "${install_root}" \
    +login anonymous \
    +app_update 343050 validate \
    +quit
else
  "${steamcmd_root}/steamcmd.sh" \
    +force_install_dir "${install_root}" \
    +login anonymous \
    +app_update 343050 \
    +quit
fi
