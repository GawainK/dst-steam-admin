<template>
  <n-layout class="shell" has-sider>
    <n-layout-sider bordered collapse-mode="width" :collapsed-width="72" :width="240" class="shell__sider">
      <div class="shell__brand">
        <div class="shell__brand-mark">DST</div>
        <div>
          <p class="shell__brand-title">Steam Admin</p>
          <p class="shell__brand-subtitle">Server Console</p>
        </div>
      </div>
      <n-menu :options="menuOptions" :value="activeSection" @update:value="onMenuSelect" />
    </n-layout-sider>
    <n-layout-content class="shell__content">
      <header class="hero" :class="{ 'hero--solo': activeSection !== 'overview' }">
        <div>
          <p class="hero__eyebrow">饥荒联机版专用服务器</p>
          <h1>{{ heroTitle }}</h1>
          <p class="hero__copy">{{ heroCopy }}</p>
          <label class="hero__refresh">
            <n-switch v-model:value="autoRefresh" size="small" />
            <span>自动刷新（{{ Math.round(REFRESH_INTERVAL_MS / 1000) }}s）</span>
          </label>
        </div>
        <StatusCard v-if="activeSection === 'overview'" :status="serverStatus" />
      </header>

      <section v-if="activeSection === 'overview'" class="panel-grid">
        <ControlPanel
          :busy-action="busyAction"
          @start="handleStart"
          @stop="handleStop"
          @restart="handleRestart"
        />
        <LogsSummary :content="logs" @view-all="activeSection = 'logs'" />
      </section>

      <section v-else-if="activeSection === 'logs'" class="page">
        <LogsPanel
          :content="logs"
          :loading="logsLoading"
          @refresh="refreshLogs"
        />
      </section>

      <section v-else-if="activeSection === 'config'" class="page">
        <ServerConfigForm
          :model-value="serverConfig"
          :steam-token-placeholder="serverConfig.steamTokenMasked ?? ''"
          :saving="configSaving"
          @update:model-value="serverConfig = $event"
          @save="saveConfig"
        />
      </section>

      <section v-else-if="activeSection === 'mods'" class="page">
        <ModsConfigPanel
          :model-value="modsConfig"
          :saving="modsSaving"
          @update:model-value="modsConfig = $event"
          @save="saveMods"
        />
      </section>

      <section v-else class="page">
        <DocsPanel :active-section="activeSection" />
      </section>
    </n-layout-content>
  </n-layout>
</template>

<script setup lang="ts">
import { TerminalSquare, ScrollText, Cog, Puzzle, BookOpenText } from "lucide-vue-next";
import {
  NButton,
  NCard,
  NLayout,
  NLayoutContent,
  NLayoutSider,
  NMenu,
  NSwitch,
  NTag,
  useMessage
} from "naive-ui";
import { computed, h, onMounted, onUnmounted, ref } from "vue";

import {
  getModsConfig,
  getServerConfig,
  getServerLogs,
  getServerStatus,
  restartServer,
  saveModsConfig,
  saveServerConfig,
  startServer,
  stopServer,
  type ModsConfig,
  type ServerConfig,
  type ServerStatus
} from "../api/client";
import ControlPanel from "./ControlPanel.vue";
import DocsPanel from "./DocsPanel.vue";
import LogsPanel from "./LogsPanel.vue";
import LogsSummary from "./LogsSummary.vue";
import ModsConfigPanel from "./ModsConfigPanel.vue";
import ServerConfigForm from "./ServerConfigForm.vue";
import StatusCard from "./StatusCard.vue";

const message = useMessage();

type SectionKey = "overview" | "logs" | "config" | "mods" | "docs";

const activeSection = ref<SectionKey>("overview");
const serverStatus = ref<ServerStatus>({
  overall: "stopped",
  containers: []
});
const logs = ref("");
const logsLoading = ref(false);
const configSaving = ref(false);
const modsSaving = ref(false);
const busyAction = ref<"start" | "stop" | "restart" | null>(null);
const autoRefresh = ref(true);
const REFRESH_INTERVAL_MS = 8000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;
const serverConfig = ref<ServerConfig>({
  steamToken: "",
  clusterName: "",
  clusterPassword: "",
  maxPlayers: 6,
  gameMode: "survival",
  enableCaves: true,
  masterPort: 10999,
  cavesPort: 11000
});
const modsConfig = ref<ModsConfig>({
  setup: "",
  overrides: ""
});

const menuOptions = [
  { label: "总览", key: "overview", icon: renderIcon(TerminalSquare) },
  { label: "实时日志", key: "logs", icon: renderIcon(ScrollText) },
  { label: "世界配置", key: "config", icon: renderIcon(Cog) },
  { label: "模组配置", key: "mods", icon: renderIcon(Puzzle) },
  { label: "部署说明", key: "docs", icon: renderIcon(BookOpenText) }
];

const heroMeta: Record<SectionKey, { title: string; copy: string }> = {
  overview: { title: "总览", copy: "查看运行状态，执行启停操作，并查看最近日志摘要。" },
  logs: { title: "实时日志", copy: "查看最近日志输出并手动刷新。" },
  config: { title: "世界配置", copy: "编辑房间名、密码、人数、端口等基础配置。" },
  mods: { title: "模组配置", copy: "编辑模组安装与覆盖配置文件。" },
  docs: { title: "部署说明", copy: "查看部署与运维命令。" }
};

const heroTitle = computed(() => heroMeta[activeSection.value]?.title ?? "总览");
const heroCopy = computed(() => heroMeta[activeSection.value]?.copy ?? "");

function renderIcon(icon: typeof TerminalSquare) {
  return () => h(icon, { size: 18 });
}

function onMenuSelect(value: string) {
  activeSection.value = value as SectionKey;
}

async function refreshStatus(silent = false) {
  try {
    serverStatus.value = await getServerStatus();
  } catch (error) {
    if (!silent) {
      message.error(asMessage(error));
    }
  }
}

async function refreshLogs(silent = false) {
  logsLoading.value = true;
  try {
    const result = await getServerLogs();
    logs.value = result.content;
  } catch (error) {
    if (!silent) {
      message.error(asMessage(error));
    }
  } finally {
    logsLoading.value = false;
  }
}

async function loadConfig() {
  try {
    const config = await getServerConfig();
    serverConfig.value = {
      ...config,
      steamToken: ""
    };
  } catch (error) {
    message.error(asMessage(error));
  }
}

async function loadMods() {
  try {
    modsConfig.value = await getModsConfig();
  } catch (error) {
    message.error(asMessage(error));
  }
}

async function withServerAction(
  action: "start" | "stop" | "restart",
  runner: () => Promise<void>
) {
  busyAction.value = action;
  try {
    await runner();
    await refreshStatus();
    message.success(`服务器${actionLabel(action)}成功`);
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    busyAction.value = null;
  }
}

function actionLabel(action: "start" | "stop" | "restart") {
  if (action === "start") return "启动";
  if (action === "stop") return "停止";
  return "重启";
}

function handleStart() {
  return withServerAction("start", startServer);
}

function handleStop() {
  return withServerAction("stop", stopServer);
}

function handleRestart() {
  return withServerAction("restart", restartServer);
}

async function saveConfig() {
  configSaving.value = true;
  try {
    await saveServerConfig(serverConfig.value);
    message.success("基础配置已保存");
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    configSaving.value = false;
  }
}

async function saveMods() {
  modsSaving.value = true;
  try {
    await saveModsConfig(modsConfig.value);
    message.success("模组配置已保存");
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    modsSaving.value = false;
  }
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}

async function autoRefreshTick() {
  if (!autoRefresh.value || refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const tasks = [refreshStatus(true)];
    if (activeSection.value === "overview" || activeSection.value === "logs") {
      tasks.push(refreshLogs(true));
    }
    await Promise.all(tasks);
  } finally {
    refreshInFlight = false;
  }
}

onMounted(async () => {
  await Promise.all([refreshStatus(), refreshLogs(), loadConfig(), loadMods()]);
  refreshTimer = setInterval(autoRefreshTick, REFRESH_INTERVAL_MS);
});

onUnmounted(() => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});
</script>
