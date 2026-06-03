<template>
  <n-card class="log-card">
    <template #header>
      <div class="section-title">
        <span>日志摘要</span>
        <n-button tertiary size="small" @click="$emit('view-all')">查看全部</n-button>
      </div>
    </template>
    <pre class="log-card__content">{{ tail || "暂无日志输出" }}</pre>
  </n-card>
</template>

<script setup lang="ts">
import { NButton, NCard } from "naive-ui";
import { computed } from "vue";

const props = defineProps<{
  content: string;
}>();

defineEmits<{
  "view-all": [];
}>();

const tail = computed(() => props.content.split("\n").slice(-20).join("\n"));
</script>
