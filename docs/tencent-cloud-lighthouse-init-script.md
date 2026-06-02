# Tencent Cloud Lighthouse Init Script

这个文档说明如何使用仓库内的初始化脚本快速完成腾讯云轻量 Ubuntu 服务器的基础环境准备。

脚本路径：

- [scripts/init-tencent-lighthouse.sh](/Users/oukai/personal/dst-steam-admin/scripts/init-tencent-lighthouse.sh)

## Script Scope

脚本会完成这些事情：

- 校验当前系统是否为 Ubuntu
- 安装 `ca-certificates`、`curl`、`git`、`gnupg`
- 配置 Docker 官方 APT 源
- 安装 Docker Engine、Buildx、Compose Plugin
- 将指定用户加入 `docker` 用户组
- 输出后续需要执行的验证命令

脚本不会做这些事情：

- 不会自动上传项目代码
- 不会自动修改 `server-config.json`
- 不会自动执行 `docker compose up -d --build`
- 不会替你在腾讯云控制台放行端口

## Usage

登录到一台全新的 Ubuntu 轻量服务器后，先上传脚本：

```bash
scp scripts/init-tencent-lighthouse.sh ubuntu@<server-ip>:/home/ubuntu/
```

然后执行：

```bash
ssh ubuntu@<server-ip>
chmod +x /home/ubuntu/init-tencent-lighthouse.sh
/home/ubuntu/init-tencent-lighthouse.sh
```

如果你的登录用户不是 `ubuntu`，可以显式传用户参数：

```bash
TARGET_USER=myuser /home/myuser/init-tencent-lighthouse.sh
```

## After Script

脚本执行完成后，重新加载用户组：

```bash
newgrp docker
```

验证 Docker：

```bash
docker --version
docker compose version
```

随后再按部署文档继续：

- [docs/tencent-cloud-lighthouse.md](/Users/oukai/personal/dst-steam-admin/docs/tencent-cloud-lighthouse.md)

## Recommended Flow

推荐顺序：

1. 在腾讯云控制台创建 `Ubuntu 22.04 LTS` 系统镜像实例
2. 放行 `22/tcp`、`8080/tcp`、`10999/udp`、`11000/udp`
3. 执行初始化脚本
4. 上传项目代码
5. 修改 `data/cluster/admin/server-config.json`
6. 执行 `docker compose up -d --build`
