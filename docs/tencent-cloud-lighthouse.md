# Tencent Cloud Lighthouse Deployment

本文档面向腾讯云轻量应用服务器（Lighthouse）上的 Ubuntu 系统镜像部署。

## Recommended Image

推荐使用：

- `Ubuntu 22.04 LTS` 系统镜像

不推荐一开始使用应用镜像。这个项目已经自带：

- `docker-compose.yml`
- `docker/api.Dockerfile`
- `docker/web.Dockerfile`
- `docker/dst/Dockerfile`

继续叠加腾讯云应用镜像，收益很低，排查成本更高。

## Security Group

在腾讯云轻量控制台放行以下端口：

- `22/tcp`：SSH
- `8080/tcp`：管理后台 Web
- `10999/udp`：DST Master
- `11000/udp`：DST Caves

可选：

- `3000/tcp`：管理后台 API。只有你明确需要公网直连 API 时再开放。

## Manual Setup

登录服务器：

```bash
ssh ubuntu@<server-ip>
```

安装基础工具：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

安装 Docker：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

把当前用户加入 Docker 组：

```bash
sudo usermod -aG docker ubuntu
newgrp docker
```

验证：

```bash
docker --version
docker compose version
```

## Upload Project

如果仓库已经有远端：

```bash
git clone https://github.com/GawainK/dst-steam-admin.git ~/dst-steam-admin
cd ~/dst-steam-admin
```

如果本地直接上传：

```bash
tar czf dst-steam-admin.tar.gz dst-steam-admin
scp dst-steam-admin.tar.gz ubuntu@<server-ip>:/home/ubuntu/
```

服务器上解压：

```bash
cd /home/ubuntu
tar xzf dst-steam-admin.tar.gz
cd dst-steam-admin
```

## Configure

编辑基础配置：

```bash
nano data/cluster/admin/server-config.json
```

至少需要确认：

- `steamToken`
- `clusterName`
- `clusterPassword`
- `maxPlayers`

如果要启用模组，再编辑：

```bash
nano data/mods/dedicated_server_mods_setup.lua
nano data/mods/modoverrides.lua
```

## Start

```bash
cd ~/dst-steam-admin
docker compose up -d --build
docker compose ps
```

查看日志：

```bash
docker compose logs -f admin-api
docker compose logs -f admin-web
docker compose logs -f dst-master
docker compose logs -f dst-caves
```

## Access

默认访问地址：

- `http://<server-ip>:8080`

## Maintenance

更新并重建：

```bash
docker compose up -d --build
```

停止：

```bash
docker compose stop
```

重启：

```bash
docker compose restart
```

下线：

```bash
docker compose down
```

## Disk Planning

建议先检查磁盘：

```bash
df -h
```

建议预留：

- 下载空间：`10 GiB+`
- 落盘空间：`15 GiB+`

## Automation

如果你希望直接初始化服务器，可以使用脚本：

- [scripts/init-tencent-lighthouse.sh](/Users/oukai/personal/dst-steam-admin/scripts/init-tencent-lighthouse.sh)
