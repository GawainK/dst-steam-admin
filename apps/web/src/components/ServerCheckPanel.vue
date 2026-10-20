<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>一键检查</span>
        <n-button type="primary" :loading="loading" :disabled="loading" @click="refresh">
          刷新检查
        </n-button>
      </div>
    </template>

    <p class="section-subtitle">检查当前运行环境和本次启动日志。只读检查，不会重启服务器。</p>
    <n-alert v-if="error" type="error" title="刷新失败" class="check-alert">
      {{ error }}{{ report ? '。下方为上次检查结果。' : '' }}
    </n-alert>
    <n-spin :show="loading">
      <template v-if="report">
        <div class="check-summary">
          <n-tag :type="report.overall === 'pass' ? 'success' : 'warning'" round>
            {{ report.overall === 'pass' ? '全部通过' : '待处理' }}
          </n-tag>
          <span class="section-subtitle">
            检查时间：<time :datetime="report.checkedAt">{{ new Date(report.checkedAt).toLocaleString() }}</time>
          </span>
        </div>

        <n-descriptions :column="1" label-placement="left" bordered size="small">
          <n-descriptions-item label="当前镜像"><code class="image-value">{{ report.image.current ?? '未检测到' }}</code></n-descriptions-item>
          <n-descriptions-item label="预期镜像"><code class="image-value">{{ report.image.expected }}</code></n-descriptions-item>
          <n-descriptions-item label="镜像 ID"><code class="image-value">{{ report.image.id ?? '未检测到' }}</code></n-descriptions-item>
          <n-descriptions-item label="游戏版本">{{ report.version ?? '未检测到' }}</n-descriptions-item>
        </n-descriptions>

        <div class="shard-checks">
          <div v-for="shard in report.shards" :key="shard.name" class="status-chip">
            <div class="section-title">
              <strong>{{ shard.name === 'Master' ? '地面 Master' : '洞穴 Caves' }}</strong>
              <n-tag :type="tagType(shard.status)" size="small">{{ statusLabel(shard.status) }}</n-tag>
            </div>
            <span v-if="shard.status === 'skipped'">本次运行未启用</span>
            <template v-else>
              <span>PID：{{ shard.pid ?? '未检测到' }} · {{ shard.ready ? '已就绪' : '未就绪' }}</span>
              <span>模组加载已确认：{{ shard.loadedMods }}/{{ report.mods.length }}</span>
            </template>
          </div>
        </div>

        <n-list bordered>
          <n-list-item v-for="item in report.items" :key="item.key">
            <div class="check-item">
              <div class="check-summary">
                <n-tag :type="tagType(item.status)" size="small">{{ statusLabel(item.status) }}</n-tag>
                <strong>{{ item.label }}</strong>
              </div>
              <span class="section-subtitle">{{ item.detail }}</span>
            </div>
          </n-list-item>
        </n-list>

        <h3>模组加载检查（{{ report.mods.length }} 个）</h3>
        <div class="mods-table">
          <n-table size="small" :single-line="false">
            <thead><tr><th>Mod ID</th><th>地面 Master</th><th>洞穴 Caves</th></tr></thead>
            <tbody>
              <tr v-for="mod in report.mods" :key="mod.id" :data-testid="`mod-${mod.id}`">
                <td>{{ mod.id }}</td>
                <td><n-tag :type="tagType(mod.master)" size="small">{{ modLabel(mod.master) }}</n-tag></td>
                <td><n-tag :type="tagType(mod.caves)" size="small">{{ modLabel(mod.caves) }}</n-tag></td>
              </tr>
            </tbody>
          </n-table>
        </div>
        <p class="section-subtitle">“已加载”表示本次启动实际加载过模组 Lua 文件，文件来自下载或缓存。启动未完成或日志已轮转时可能显示“待确认”。游戏内功能及地面、洞穴实际往返仍需玩家验收。</p>
      </template>
      <n-empty v-else :description="loading ? '正在检查…' : '暂无检查结果，请点击刷新检查'" />
    </n-spin>
  </n-card>
</template>

<script setup lang="ts">
import { NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NEmpty, NList, NListItem, NSpin, NTable, NTag } from "naive-ui";
import { onMounted, ref } from "vue";

import { getServerCheck, type CheckStatus, type ServerCheckReport } from "../api/client";

const report = ref<ServerCheckReport | null>(null);
const loading = ref(false);
const error = ref("");

function tagType(status: CheckStatus) {
  return ({ pass: "success", check: "error", unknown: "warning", skipped: "default" } as const)[status];
}

function statusLabel(status: CheckStatus) {
  return { pass: "通过", check: "未通过", unknown: "待确认", skipped: "未启用" }[status];
}

function modLabel(status: CheckStatus) {
  return status === "pass" ? "已加载" : statusLabel(status);
}

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    report.value = await getServerCheck();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "检查请求失败";
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);
</script>

<style scoped>
.check-summary { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.check-alert, .check-summary { margin-bottom: 12px; }
.image-value { overflow-wrap: anywhere; }
.shard-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
.check-item { display: flex; flex-direction: column; gap: 4px; }
.check-item .check-summary { margin-bottom: 0; }
.mods-table { overflow-x: auto; }
.mods-table table { min-width: 400px; }
@media (max-width: 640px) { .shard-checks { grid-template-columns: 1fr; } }
</style>
