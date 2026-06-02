import { createApp } from "vue";
import { create, NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider } from "naive-ui";

import App from "./App.vue";
import "./styles.css";

const naive = create({
  components: [
    NConfigProvider,
    NDialogProvider,
    NMessageProvider,
    NNotificationProvider
  ]
});

createApp(App).use(naive).mount("#app");
