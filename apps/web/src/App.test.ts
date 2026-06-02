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

    const steamTokenInput = wrapper.find('input[type="password"]');

    expect((steamTokenInput.element as HTMLInputElement).value).toBe("");
    expect(steamTokenInput.attributes("placeholder")).toBe("abc***");
  });
});
