import { mount } from "@vue/test-utils";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

vi.mock("../api/client", () => ({
  getAdminList: vi.fn(async () => ({
    items: [{ id: "KU_ADMIN1" }]
  })),
  addAdmin: vi.fn(async () => undefined),
  removeAdmin: vi.fn(async () => undefined)
}));

import * as client from "../api/client";
import AdminConfigPanel from "./AdminConfigPanel.vue";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mountWithProvider(attachTo?: HTMLElement) {
  const Wrapper = defineComponent({
    render() {
      return h(NMessageProvider, null, {
        default: () => h(AdminConfigPanel)
      });
    }
  });
  return mount(Wrapper, attachTo ? { attachTo } : {});
}

describe("AdminConfigPanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("挂载后渲染管理员列表", async () => {
    const wrapper = mountWithProvider();

    await flush();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("KU_ADMIN1");
    expect(wrapper.text()).toContain("Klei 用户 ID");
  });

  it("点击添加调用 addAdmin", async () => {
    const wrapper = mountWithProvider();

    await flush();
    await wrapper.vm.$nextTick();
    await wrapper.find("input").setValue("KU_NEWADMIN");
    const addButton = wrapper.findAll("button").find((button) => button.text().includes("添加"));
    await addButton!.trigger("click");
    await flush();

    expect(client.addAdmin).toHaveBeenCalledWith("KU_NEWADMIN");
  });

  it("确认删除调用 removeAdmin", async () => {
    const wrapper = mountWithProvider(document.body);

    await flush();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-testid="remove-admin-KU_ADMIN1"]').trigger("click");
    const confirm = document.body.querySelector(
      ".n-popconfirm__action .n-button--primary-type"
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    confirm?.click();
    await flush();

    expect(client.removeAdmin).toHaveBeenCalledWith("KU_ADMIN1");
  });
});
