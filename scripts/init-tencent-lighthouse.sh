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

echo "[1/6] Updating apt metadata"
sudo apt update

echo "[2/6] Installing base packages"
sudo apt install -y ca-certificates curl git gnupg

echo "[3/6] Configuring Docker apt repository"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  ${VERSION_CODENAME} stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

echo "[4/6] Refreshing apt metadata for Docker repository"
sudo apt update

echo "[5/6] Installing Docker Engine and Compose plugin"
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "[6/6] Adding ${TARGET_USER} to docker group"
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
