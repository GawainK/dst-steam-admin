<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>模组配置</span>
        <span class="section-subtitle">列表管理，复杂配置可用高级原文编辑</span>
      </div>
    </template>

    <div class="add-row">
      <n-input
        v-model:value="newId"
        placeholder="输入 Workshop ID，如 378160973"
        @keyup.enter="onAdd"
      />
      <n-button type="primary" :loading="adding" @click="onAdd">添加</n-button>
    </div>

    <n-spin :show="loading">
      <n-empty v-if="items.length === 0" description="暂无模组" class="empty" />
      <n-list v-else bordered>
        <n-list-item v-for="item in items" :key="item.id">
          <div class="mod-row">
            <div class="mod-info">
              <span class="mod-name">{{ item.name ?? `模组 ${item.id}` }}</span>
              <a
                class="mod-id"
                :href="`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`"
                target="_blank"
                rel="noreferrer"
                >{{ item.id }}</a
              >
            </div>
            <div class="mod-actions">
              <n-switch
                :value="item.enabled"
                :loading="busyId === item.id"
                @update:value="(value: boolean) => onToggle(item, value)"
              />
              <n-button quaternary size="small" @click="openConfig(item)">查看配置</n-button>
              <n-popconfirm @positive-click="onRemove(item)">
                <template #trigger>
                  <n-button quaternary type="error" size="small" :data-testid="`remove-${item.id}`">
                    删除
                  </n-button>
                </template>
                确认删除该模组？
              </n-popconfirm>
            </div>
          </div>
        </n-list-item>
      </n-list>
    </n-spin>

    <n-collapse class="advanced">
      <n-collapse-item title="高级 · 原文编辑" name="raw">
        <n-tabs type="line" animated>
          <n-tab-pane name="setup" tab="dedicated_server_mods_setup.lua">
            <n-input v-model:value="draft.setup" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" />
          </n-tab-pane>
          <n-tab-pane name="overrides" tab="modoverrides.lua">
            <n-input v-model:value="draft.overrides" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" />
          </n-tab-pane>
        </n-tabs>
        <n-button type="primary" :loading="saving" @click="emitSave">保存模组配置</n-button>
      </n-collapse-item>
    </n-collapse>

    <n-modal v-model:show="configVisible" preset="card" style="max-width: 640px" title="模组配置">
      <n-input :value="configText" type="textarea" readonly :autosize="{ minRows: 6, maxRows: 20 }" />
    </n-modal>
  </n-card>
</template>

<script setup lang="ts">
import {
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInput,
  NList,
  NListItem,
  NModal,
  NPopconfirm,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  useMessage
} from "naive-ui";
import { onMounted, reactive, ref, watch } from "vue";

import {
  addMod as apiAddMod,
  getModList,
  removeMod as apiRemoveMod,
  setModEnabled,
  type ModListItem,
  type ModsConfig
} from "../api/client";

const props = defineProps<{
  modelValue: ModsConfig;
  saving: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [ModsConfig];
  save: [];
}>();

const message = useMessage();
const draft = reactive({ ...props.modelValue });
const items = ref<ModListItem[]>([]);
const loading = ref(false);
const adding = ref(false);
const busyId = ref<string | null>(null);
const newId = ref("");
const configVisible = ref(false);
const configText = ref("");

watch(
  () => props.modelValue,
  (value) => Object.assign(draft, value),
  { deep: true }
);

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

async function refresh() {
  loading.value = true;
  try {
    items.value = (await getModList()).items;
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    loading.value = false;
  }
}

async function onAdd() {
  const id = newId.value.trim();
  if (!id || adding.value) return;
  adding.value = true;
  try {
    await apiAddMod(id);
    newId.value = "";
    message.success("已添加模组");
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    adding.value = false;
  }
}

async function onToggle(item: ModListItem, value: boolean) {
  busyId.value = item.id;
  try {
    await setModEnabled(item.id, value);
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  } finally {
    busyId.value = null;
  }
}

async function onRemove(item: ModListItem) {
  try {
    await apiRemoveMod(item.id);
    message.success("已删除模组");
    await refresh();
  } catch (error) {
    message.error(asMessage(error));
  }
}

function openConfig(item: ModListItem) {
  configText.value = item.configRaw || "（该模组没有覆盖配置）";
  configVisible.value = true;
}

function emitSave() {
  emit("update:modelValue", { ...draft });
  emit("save");
}

onMounted(refresh);
</script>

<style scoped>
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.mod-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.mod-info {
  display: flex;
  flex-direction: column;
}
.mod-name {
  font-weight: 600;
}
.mod-id {
  font-size: 12px;
  opacity: 0.7;
}
.mod-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.advanced {
  margin-top: 16px;
}
.empty {
  padding: 24px 0;
}
</style>
