<template>
  <n-config-provider>
    <n-notification-provider>
      <n-message-provider>
        <AppShell />
      </n-message-provider>
    </n-notification-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import {
  NConfigProvider,
  NMessageProvider,
  NNotificationProvider
} from "naive-ui";

import AppShell from "./components/AppShell.vue";
</script>
