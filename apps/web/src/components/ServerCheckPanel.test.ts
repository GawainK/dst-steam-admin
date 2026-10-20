import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ getServerCheck: vi.fn() }));
import { getServerCheck, type ServerCheckReport } from "../api/client";
import ServerCheckPanel from "./ServerCheckPanel.vue";

const image = "ghcr.io/gawaink/dst-steam-admin/dst-server:sha-b27bd98d4a47";
const ids = "831523966 1200745268 2287303119 1909182187 2847908822 623749604 604761020 2753774601 2078243581 362175979 1185229307 1207269058 3753319890 3760106287 378160973".split(" ");
function report(): ServerCheckReport {
  return {
    checkedAt: "2026-10-20T06:00:00Z", overall: "pass", version: "756039",
    image: { current: image, expected: image, id: "sha256:test-runtime" },
    items: [{ key: "binding", label: "地面与洞穴连接", status: "pass", detail: "两侧已完成连接。" }],
    shards: [
      { name: "Master", status: "pass", pid: 10, ready: true, loadedMods: 15 },
      { name: "Caves", status: "pass", pid: 11, ready: true, loadedMods: 15 }
    ],
    mods: ids.map((id) => ({ id, master: "pass", caves: "pass" }))
  };
}

beforeEach(() => {
  vi.mocked(getServerCheck).mockResolvedValue(report());
});
afterEach(() => vi.resetAllMocks());

describe("ServerCheckPanel", () => {
  it("loads and shows the current image, two shards, check timestamp and all 15 mods", async () => {
    const wrapper = mount(ServerCheckPanel);
    await flushPromises();
    expect(getServerCheck).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain(image);
    expect(wrapper.text()).toContain("地面 Master");
    expect(wrapper.text()).toContain("洞穴 Caves");
    expect(wrapper.text()).toContain("15/15");
    expect(wrapper.text()).toContain("全部通过");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-10-20T06:00:00Z");
    for (const id of ids) expect(wrapper.get(`[data-testid="mod-${id}"]`).text()).toContain("已加载");
  });

  it("shows missing mod evidence and refreshes on demand", async () => {
    const result = report();
    result.overall = "check";
    result.mods[0].caves = "unknown";
    result.shards[1].loadedMods = 14;
    vi.mocked(getServerCheck).mockResolvedValueOnce(result);
    const wrapper = mount(ServerCheckPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("待处理");
    expect(wrapper.text()).toContain("14/15");
    expect(wrapper.get(`[data-testid="mod-${ids[0]}"]`).text()).toContain("待确认");
    expect(getServerCheck).toHaveBeenCalledTimes(1);
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(getServerCheck).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("全部通过");
  });

  it("retains the previous timestamp and marks a failed refresh", async () => {
    const wrapper = mount(ServerCheckPanel);
    await flushPromises();
    vi.mocked(getServerCheck).mockRejectedValueOnce(new Error("网络连接失败"));
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("刷新失败");
    expect(wrapper.text()).toContain("网络连接失败");
    expect(wrapper.text()).toContain("上次检查结果");
    expect(wrapper.get("time").attributes("datetime")).toBe("2026-10-20T06:00:00Z");
  });

  it("does not show successful results when the initial request fails", async () => {
    vi.mocked(getServerCheck).mockRejectedValueOnce(new Error("无法连接 API"));
    const wrapper = mount(ServerCheckPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("无法连接 API");
    expect(wrapper.text()).not.toContain("全部通过");
    expect(wrapper.find("time").exists()).toBe(false);
  });

  it("disables refresh while collecting results", async () => {
    vi.mocked(getServerCheck).mockImplementationOnce(() => new Promise(() => {}));
    const wrapper = mount(ServerCheckPanel);
    await wrapper.vm.$nextTick();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    await wrapper.get("button").trigger("click");
    expect(getServerCheck).toHaveBeenCalledTimes(1);
  });
});
