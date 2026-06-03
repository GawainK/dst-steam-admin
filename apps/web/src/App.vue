<template>
  <n-config-provider :theme="darkTheme" :theme-overrides="themeOverrides">
    <n-notification-provider>
      <n-message-provider>
        <AppShell />
      </n-message-provider>
    </n-notification-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import {
  darkTheme,
  NConfigProvider,
  NMessageProvider,
  NNotificationProvider,
  type GlobalThemeOverrides
} from "naive-ui";

import AppShell from "./components/AppShell.vue";

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#e8994f",
    primaryColorHover: "#f0a860",
    primaryColorPressed: "#c75b43",
    primaryColorSuppl: "#f0a860",
    textColorBase: "#f5e9df",
    borderRadius: "12px"
  },
  Card: {
    color: "rgba(36, 23, 16, 0.5)",
    colorModal: "rgba(28, 18, 14, 0.92)",
    borderColor: "rgba(232, 205, 180, 0.18)"
  }
};
</script>
