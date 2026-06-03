import { mount } from "@vue/test-utils";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

vi.mock("../api/client", () => ({
  getModList: vi.fn(async () => ({
    items: [
      { id: "111", name: "Global Positions", enabled: true, inSetup: true, configRaw: "raw-111" }
    ]
  })),
  getModsConfig: vi.fn(async () => ({ setup: "", overrides: "" })),
  addMod: vi.fn(async () => undefined),
  removeMod: vi.fn(async () => undefined),
  setModEnabled: vi.fn(async () => undefined)
}));

import * as client from "../api/client";
import ModsConfigPanel from "./ModsConfigPanel.vue";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mountWithProvider(props: { modelValue: { setup: string; overrides: string }; saving: boolean }, attachTo?: HTMLElement) {
  const Wrapper = defineComponent({
    render() {
      return h(NMessageProvider, null, {
        default: () => h(ModsConfigPanel, props)
      });
    }
  });
  return mount(Wrapper, attachTo ? { attachTo } : {});
}

describe("ModsConfigPanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("挂载后渲染模组列表", async () => {
    const wrapper = mountWithProvider({ modelValue: { setup: "", overrides: "" }, saving: false });
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Global Positions");
    expect(wrapper.text()).toContain("111");
    // inSetup: true — 不应显示未下载标签
    expect(wrapper.text()).not.toContain("未下载");
  });

  it("inSetup 为 false 时显示未下载标签", async () => {
    (client.getModList as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        { id: "222", name: "Missing Mod", enabled: false, inSetup: false, configRaw: "" }
      ]
    });
    const wrapper = mountWithProvider({ modelValue: { setup: "", overrides: "" }, saving: false });
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Missing Mod");
    expect(wrapper.text()).toContain("未下载");
  });

  it("点击删除调用 removeMod", async () => {
    const wrapper = mountWithProvider(
      { modelValue: { setup: "", overrides: "" }, saving: false },
      document.body
    );
    await flush();
    await wrapper.vm.$nextTick();

    const removeButton = wrapper.get('[data-testid="remove-111"]');
    await removeButton.trigger("click");
    const confirm = document.body.querySelector(
      ".n-popconfirm__action .n-button--primary-type"
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    confirm?.click();
    await flush();

    expect(client.removeMod).toHaveBeenCalledWith("111");
  });
});
