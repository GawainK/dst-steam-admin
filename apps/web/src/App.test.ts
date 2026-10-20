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
    expect(wrapper.text()).toContain("一键检查");
    expect(wrapper.text()).toContain("实时日志");
    expect(wrapper.text()).toContain("模组配置");
    expect(wrapper.text()).toContain("管理员设置");
  });

  it("opens server checks from navigation and loads its read-only report", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input) === "/api/server/check" ? {
        checkedAt: "2026-10-20T06:00:00Z", overall: "check", version: null,
        image: { current: "runtime:current", expected: "runtime:expected", id: "sha256:test" },
        items: [], shards: [], mods: []
      } : {
        overall: "stopped", containers: [], content: "", steamToken: "", steamTokenMasked: "",
        clusterName: "", clusterPassword: "", maxPlayers: 6, gameMode: "survival",
        enableCaves: true, masterPort: 10999, cavesPort: 11000, setup: "", overrides: ""
      },
      text: async () => ""
    }));
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(App);
    await flushPromises();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/server/check")).toBe(false);
    const menu = wrapper.findAll(".n-menu-item-content").find((item) => item.text().includes("一键检查"));
    await menu!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("runtime:current");
    expect(wrapper.text()).toContain("刷新检查");
    expect(fetchMock).toHaveBeenCalledWith("/api/server/check", expect.any(Object));
    expect(wrapper.find(".hero__refresh").exists()).toBe(false);
    wrapper.unmount();
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

  it("polls the status endpoint on an interval while auto-refresh is on", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
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
    });
    vi.stubGlobal("fetch", fetchMock);

    mount(App);
    // 冲洗初始 onMounted 的异步加载，使轮询定时器注册完成
    await vi.advanceTimersByTimeAsync(0);

    const statusCalls = () =>
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/api/server/status")
      ).length;

    const before = statusCalls();
    await vi.advanceTimersByTimeAsync(8000);

    expect(statusCalls()).toBeGreaterThan(before);

    vi.useRealTimers();
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

  it("switches to admin settings and renders the admin list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);

        if (url.includes("/api/config/admins")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              items: [{ id: "KU_ADMIN1" }]
            }),
            text: async () => ""
          });
        }

        if (url.includes("/api/config/server")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              steamToken: "",
              steamTokenMasked: "",
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

    const adminItem = wrapper
      .findAll(".n-menu-item-content")
      .find((item) => item.text().includes("管理员设置"));
    await adminItem!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("管理 DST 世界内管理员 Klei ID");
    expect(wrapper.text()).toContain("KU_ADMIN1");
  });
});
