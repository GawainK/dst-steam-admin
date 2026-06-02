<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>模组配置</span>
        <span class="section-subtitle">Lua 文本原样保存</span>
      </div>
    </template>
    <n-tabs type="line" animated>
      <n-tab-pane name="setup" tab="dedicated_server_mods_setup.lua">
        <n-input v-model:value="draft.setup" type="textarea" :autosize="{ minRows: 10, maxRows: 18 }" />
      </n-tab-pane>
      <n-tab-pane name="overrides" tab="modoverrides.lua">
        <n-input v-model:value="draft.overrides" type="textarea" :autosize="{ minRows: 10, maxRows: 18 }" />
      </n-tab-pane>
    </n-tabs>
    <n-button type="primary" :loading="saving" @click="emitSave">保存模组配置</n-button>
  </n-card>
</template>

<script setup lang="ts">
import { NButton, NCard, NInput, NTabPane, NTabs } from "naive-ui";
import { reactive, watch } from "vue";

import type { ModsConfig } from "../api/client";

const props = defineProps<{
  modelValue: ModsConfig;
  saving: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [ModsConfig];
  save: [];
}>();

const draft = reactive({ ...props.modelValue });

watch(
  () => props.modelValue,
  (value) => {
    Object.assign(draft, value);
  },
  { deep: true }
);

function emitSave() {
  emit("update:modelValue", { ...draft });
  emit("save");
}
</script>
