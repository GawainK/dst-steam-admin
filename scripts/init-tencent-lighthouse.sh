#!/usr/bin/env bash
set -euo pipefail

TARGET_USER="${TARGET_USER:-${SUDO_USER:-$(id -un)}}"

if [[ ! -f /etc/os-release ]]; then
  echo "Missing /etc/os-release, unsupported environment."
  exit 1
fi

. /etc/os-release

if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This script is intended for Ubuntu. Current ID=${ID:-unknown}."
  exit 1
fi

echo "[1/7] Removing installed packages that conflict with Docker CE"
# Ubuntu's Compose/Buildx plugins share paths with Docker's official packages.
# Remove only packages actually selected for installation, before any apt install.
conflicting_packages=()
while read -r package_name selection; do
  if [[ "${selection}" == "install" || "${selection}" == "hold" ]]; then
    conflicting_packages+=("${package_name}")
  fi
done < <(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc 2>/dev/null)
if (( ${#conflicting_packages[@]} )); then
  sudo apt remove -y "${conflicting_packages[@]}"
fi

echo "[2/7] Updating apt metadata"
sudo apt update

echo "[3/7] Installing base packages"
sudo apt install -y ca-certificates curl git gnupg

echo "[4/7] Configuring Docker apt repository"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  ${VERSION_CODENAME} stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

echo "[5/7] Refreshing apt metadata for Docker repository"
sudo apt update

echo "[6/7] Installing Docker Engine and Compose plugin"
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "[7/7] Adding ${TARGET_USER} to docker group"
sudo usermod -aG docker "${TARGET_USER}"

cat <<EOF

Initialization complete.

Run these commands next:

  newgrp docker
  docker --version
  docker compose version

Then upload the project and continue with:

  docs/tencent-cloud-lighthouse.md

EOF
