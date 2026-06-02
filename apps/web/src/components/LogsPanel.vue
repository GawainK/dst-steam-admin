<template>
  <n-card class="log-card">
    <template #header>
      <div class="section-title">
        <span>实时日志</span>
        <n-button tertiary size="small" :loading="loading" @click="$emit('refresh')">刷新</n-button>
      </div>
    </template>
    <pre class="log-card__content">{{ content || "暂无日志输出" }}</pre>
  </n-card>
</template>

<script setup lang="ts">
import { NButton, NCard } from "naive-ui";

defineProps<{
  content: string;
  loading: boolean;
}>();

defineEmits<{
  refresh: [];
}>();
</script>
