<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>服务器状态</span>
        <n-tag :type="tagType" round>{{ label }}</n-tag>
      </div>
    </template>
    <n-grid cols="2" :x-gap="12" :y-gap="12">
      <n-grid-item v-for="container in status.containers" :key="container.name">
        <div class="status-chip">
          <strong>{{ container.name }}</strong>
          <span>{{ container.status || container.state }}</span>
        </div>
      </n-grid-item>
    </n-grid>
  </n-card>
</template>

<script setup lang="ts">
import { NCard, NGrid, NGridItem, NTag } from "naive-ui";
import { computed } from "vue";

import type { ServerStatus } from "../api/client";

const props = defineProps<{
  status: ServerStatus;
}>();

const tagType = computed(() => {
  if (props.status.overall === "running") return "success";
  if (props.status.overall === "starting") return "info";
  if (props.status.overall === "partial") return "warning";
  return "error";
});

const label = computed(() => {
  if (props.status.overall === "running") return "运行中";
  if (props.status.overall === "starting") return "启动中…";
  if (props.status.overall === "partial") return "部分运行";
  return "已停止";
});
</script>
