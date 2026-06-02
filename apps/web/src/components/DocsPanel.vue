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

const instructions = `pnpm install
pnpm dev

docker compose up -d --build
docker compose logs -f dst-master dst-caves`;
</script>
