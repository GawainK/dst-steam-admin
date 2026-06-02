import { mount } from "@vue/test-utils";
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
});
