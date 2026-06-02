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
      <header class="hero">
        <div>
          <p class="hero__eyebrow">饥荒联机版专用服务器</p>
          <h1>总览</h1>
          <p class="hero__copy">查看运行状态，执行启停操作，并维护基础配置与模组配置。</p>
        </div>
        <StatusCard :status="serverStatus" />
      </header>

      <section class="panel-grid">
        <ControlPanel
          :busy-action="busyAction"
          @start="handleStart"
          @stop="handleStop"
          @restart="handleRestart"
        />
        <LogsPanel
          :content="logs"
          :loading="logsLoading"
          @refresh="refreshLogs"
        />
      </section>

      <section class="panel-grid panel-grid--forms">
        <ServerConfigForm
          :model-value="serverConfig"
          :steam-token-placeholder="serverConfig.steamTokenMasked ?? ''"
          :saving="configSaving"
          @update:model-value="serverConfig = $event"
          @save="saveConfig"
        />
        <ModsConfigPanel
          :model-value="modsConfig"
          :saving="modsSaving"
          @update:model-value="modsConfig = $event"
          @save="saveMods"
        />
      </section>

      <DocsPanel :active-section="activeSection" />
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
  NTag,
  useMessage
} from "naive-ui";
import { h, onMounted, ref } from "vue";

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
import ModsConfigPanel from "./ModsConfigPanel.vue";
import ServerConfigForm from "./ServerConfigForm.vue";
import StatusCard from "./StatusCard.vue";

const message = useMessage();

const activeSection = ref("overview");
const serverStatus = ref<ServerStatus>({
  overall: "stopped",
  containers: []
});
const logs = ref("");
const logsLoading = ref(false);
const configSaving = ref(false);
const modsSaving = ref(false);
const busyAction = ref<"start" | "stop" | "restart" | null>(null);
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

function renderIcon(icon: typeof TerminalSquare) {
  return () => h(icon, { size: 18 });
}

function onMenuSelect(value: string) {
  activeSection.value = value;
}

async function refreshStatus() {
  try {
    serverStatus.value = await getServerStatus();
  } catch (error) {
    message.error(asMessage(error));
  }
}

async function refreshLogs() {
  logsLoading.value = true;
  try {
    const result = await getServerLogs();
    logs.value = result.content;
  } catch (error) {
    message.error(asMessage(error));
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

onMounted(async () => {
  await Promise.all([refreshStatus(), refreshLogs(), loadConfig(), loadMods()]);
});
</script>
