<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>世界配置</span>
        <span class="section-subtitle">基础房间参数</span>
      </div>
    </template>
    <n-form :model="draft" label-placement="top">
      <n-grid cols="2" :x-gap="12">
        <n-grid-item>
          <n-form-item label="Steam Token">
            <n-input v-model:value="draft.steamToken" type="password" show-password-on="click" />
          </n-form-item>
        </n-grid-item>
        <n-grid-item>
          <n-form-item label="房间名">
            <n-input v-model:value="draft.clusterName" />
          </n-form-item>
        </n-grid-item>
        <n-grid-item>
          <n-form-item label="房间密码">
            <n-input v-model:value="draft.clusterPassword" type="password" show-password-on="click" />
          </n-form-item>
        </n-grid-item>
        <n-grid-item>
          <n-form-item label="游戏模式">
            <n-select v-model:value="draft.gameMode" :options="modeOptions" />
          </n-form-item>
        </n-grid-item>
        <n-grid-item>
          <n-form-item label="最大人数">
            <n-input-number v-model:value="draft.maxPlayers" :min="1" :max="64" />
          </n-form-item>
        </n-grid-item>
        <n-grid-item>
          <n-form-item label="开启洞穴">
            <n-switch v-model:value="draft.enableCaves" />
          </n-form-item>
        </n-grid-item>
        <n-grid-item>
          <n-form-item label="Master 端口">
            <n-input-number v-model:value="draft.masterPort" :min="1024" :max="65535" />
          </n-form-item>
        </n-grid-item>
        <n-grid-item>
          <n-form-item label="Caves 端口">
            <n-input-number v-model:value="draft.cavesPort" :min="1024" :max="65535" />
          </n-form-item>
        </n-grid-item>
      </n-grid>
      <n-button type="primary" :loading="saving" @click="emitSave">保存配置</n-button>
    </n-form>
  </n-card>
</template>

<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch
} from "naive-ui";
import { reactive, watch } from "vue";

import type { ServerConfig } from "../api/client";

const props = defineProps<{
  modelValue: ServerConfig;
  saving: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [ServerConfig];
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

const modeOptions = [
  { label: "生存", value: "survival" },
  { label: "无尽", value: "endless" },
  { label: "荒野", value: "wilderness" }
];

function emitSave() {
  emit("update:modelValue", { ...draft });
  emit("save");
}
</script>
