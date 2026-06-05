<template>
  <n-card class="glass-card docs-card">
    <template #header>
      <div class="section-title">
        <span>部署说明</span>
        <n-tag type="info" round>{{ sectionLabel }}</n-tag>
      </div>
    </template>
    <n-scrollbar x-scrollable>
      <pre class="docs-card__content">{{ instructions }}</pre>
    </n-scrollbar>
  </n-card>
</template>

<script setup lang="ts">
import { NCard, NScrollbar, NTag } from "naive-ui";
import { computed } from "vue";

const props = defineProps<{
  activeSection: string;
}>();

const sectionLabel = computed(() => {
  if (props.activeSection === "logs") return "日志";
  if (props.activeSection === "mods") return "模组";
  if (props.activeSection === "config") return "配置";
  return "总览";
});

const instructions = `# 本地开发
pnpm install
pnpm dev
# API: http://127.0.0.1:3000  Web: http://127.0.0.1:5173

# 首次部署（服务器）
cp .env.example .env          # 先设置 BASIC_AUTH_PASSWORD，否则 admin-web 拒绝启动
docker compose up -d --build
docker compose ps             # 8080 后台 / 10999·11000 udp 游戏端口

# 更新后台（前端 + 后端，不动游戏容器）
cd ~/dst-steam-admin
git pull origin main
docker compose up -d --build admin-web admin-api
# 浏览器强制刷新（Cmd+Shift+R / Ctrl+F5）清缓存
# 注意：别带上 dst-master / dst-caves，重建会触发 SteamCMD 校验、白白断线重启游戏服

# 改了 DST 脚本/模板（render-config.sh、*.ini.template）才需重建游戏镜像
docker compose up -d --build dst-master dst-caves   # 不会重下 15GB，按 buildid 增量

# 让新写入的世界/模组配置生效：总览点重启，或
docker compose restart dst-master dst-caves

# 存档备份/恢复（存档备份面板）
# - 备份落在宿主机 data/backups/*.tar.gz（不含 Steam token）
# - 恢复前必须先停服，否则被拒绝；恢复保留磁盘上现有 token
docker compose stop dst-master dst-caves            # 恢复存档前先停服

# 查看日志
docker compose logs -f --tail=100 dst-master dst-caves
docker compose logs --tail=200 admin-api            # 后台 API 排错`;
</script>
