import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows navigation sections for ops workflows", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          overall: "stopped",
          containers: [],
          content: "",
          steamToken: "",
          clusterName: "",
          clusterPassword: "",
          maxPlayers: 6,
          gameMode: "survival",
          enableCaves: true,
          masterPort: 10999,
          cavesPort: 11000,
          setup: "",
          overrides: ""
        }),
        text: async () => ""
      })
    );

    const wrapper = mount(App);

    expect(wrapper.text()).toContain("总览");
    expect(wrapper.text()).toContain("实时日志");
    expect(wrapper.text()).toContain("模组配置");
  });

  it("switches the visible page when a menu item is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          overall: "stopped",
          containers: [],
          content: "",
          steamToken: "",
          steamTokenMasked: "",
          clusterName: "",
          clusterPassword: "",
          maxPlayers: 6,
          gameMode: "survival",
          enableCaves: true,
          masterPort: 10999,
          cavesPort: 11000,
          setup: "",
          overrides: ""
        }),
        text: async () => ""
      })
    );

    const wrapper = mount(App);
    await flushPromises();

    // 默认在总览页：有启停控制，没有配置表单的 password 输入
    expect(wrapper.text()).toContain("启动服务器");
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);

    // 切到「世界配置」
    const items = wrapper.findAll(".n-menu-item-content");
    const configItem = items.find((item) => item.text().includes("世界配置"));
    expect(configItem).toBeTruthy();
    await configItem!.trigger("click");
    await flushPromises();

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
  });

  it("keeps the steam token input empty while showing masked placeholder text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);

        if (url.includes("/api/config/server")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              steamToken: "",
              steamTokenMasked: "abc***",
              clusterName: "Test Cluster",
              clusterPassword: "",
              maxPlayers: 6,
              gameMode: "survival",
              enableCaves: true,
              masterPort: 10999,
              cavesPort: 11000
            }),
            text: async () => ""
          });
        }

        if (url.includes("/api/config/mods")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              setup: "",
              overrides: ""
            }),
            text: async () => ""
          });
        }

        if (url.includes("/api/server/logs")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ content: "" }),
            text: async () => ""
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            overall: "stopped",
            containers: []
          }),
          text: async () => ""
        });
      })
    );

    const wrapper = mount(App);
    await flushPromises();

    const configItem = wrapper
      .findAll(".n-menu-item-content")
      .find((item) => item.text().includes("世界配置"));
    await configItem!.trigger("click");
    await flushPromises();

    const steamTokenInput = wrapper.find('input[type="password"]');

    expect((steamTokenInput.element as HTMLInputElement).value).toBe("");
    expect(steamTokenInput.attributes("placeholder")).toBe("abc***");
  });
});
