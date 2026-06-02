<template>
  <n-card class="glass-card">
    <template #header>
      <div class="section-title">
        <span>服务器控制</span>
        <span class="section-subtitle">危险操作会二次确认</span>
      </div>
    </template>
    <div class="control-actions">
      <n-button type="primary" :loading="busyAction === 'start'" @click="$emit('start')">
        启动服务器
      </n-button>
      <n-button type="warning" ghost @click="confirming = 'stop'">
        停止服务器
      </n-button>
      <n-button type="error" ghost @click="confirming = 'restart'">
        重启服务器
      </n-button>
    </div>
    <n-modal :show="confirming !== null" preset="dialog" title="确认操作" @update:show="handleModalShow">
      <template #default>
        {{ confirming === "stop" ? "确认停止服务器？" : "确认重启服务器？" }}
      </template>
      <template #action>
        <n-space justify="end">
          <n-button @click="confirming = null">取消</n-button>
          <n-button
            :data-testid="confirming === 'restart' ? 'confirm-restart' : 'confirm-stop'"
            type="primary"
            @click="confirmAction"
          >
            确认
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </n-card>
</template>

<script setup lang="ts">
import { NButton, NCard, NModal, NSpace } from "naive-ui";
import { ref } from "vue";

const props = defineProps<{
  busyAction: "start" | "stop" | "restart" | null;
}>();

const emit = defineEmits<{
  start: [];
  stop: [];
  restart: [];
}>();

void props;

const confirming = ref<"stop" | "restart" | null>(null);

function handleModalShow(value: boolean) {
  if (!value) {
    confirming.value = null;
  }
}

function confirmAction() {
  if (confirming.value === "stop") {
    emit("stop");
  }

  if (confirming.value === "restart") {
    emit("restart");
  }

  confirming.value = null;
}
</script>
