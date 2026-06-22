import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import type { ServerConfig } from "../api/client";
import ServerConfigForm from "./ServerConfigForm.vue";

const baseConfig: ServerConfig = {
  steamToken: "",
  steamTokenMasked: "abc***",
  clusterName: "Test Cluster",
  clusterPassword: "",
  maxPlayers: 6,
  gameMode: "survival",
  enableCaves: true,
  masterPort: 10999,
  cavesPort: 11000
};

describe("ServerConfigForm", () => {
  it("shows compose-managed ports as non-editable values", () => {
    const wrapper = mount(ServerConfigForm, {
      props: {
        modelValue: baseConfig,
        steamTokenPlaceholder: "abc***",
        saving: false
      }
    });

    const masterPort = wrapper.get('[data-testid="master-port"]');
    const cavesPort = wrapper.get('[data-testid="caves-port"]');

    expect(masterPort.find("input").attributes("disabled")).toBeDefined();
    expect(cavesPort.find("input").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("端口由 Docker Compose 暴露");
  });
});
