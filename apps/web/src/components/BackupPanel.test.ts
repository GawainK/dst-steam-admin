import { mount } from "@vue/test-utils";
import { NMessageProvider } from "naive-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

vi.mock("../api/client", () => ({
  listBackups: vi.fn(async () => ({
    items: [{ name: "dst-save-20260605-120000.tar.gz", createdAt: "2026-06-05T12:00:00.000Z", size: 2048 }]
  })),
  createBackup: vi.fn(async () => ({ name: "new.tar.gz", createdAt: "x", size: 1 })),
  restoreBackup: vi.fn(async () => undefined),
  deleteBackup: vi.fn(async () => undefined),
  backupDownloadUrl: (name: string) => `/api/backups/${name}/download`
}));

import * as client from "../api/client";
import BackupPanel from "./BackupPanel.vue";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mountPanel(attachTo?: HTMLElement) {
  const Wrapper = defineComponent({
    render() {
      return h(NMessageProvider, null, { default: () => h(BackupPanel) });
    }
  });
  return mount(Wrapper, attachTo ? { attachTo } : {});
}

describe("BackupPanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("挂载后渲染备份列表", async () => {
    const wrapper = mountPanel();
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("dst-save-20260605-120000.tar.gz");
    expect(wrapper.text()).toContain("2.0 KB");
  });

  it("点击立即备份调用 createBackup", async () => {
    const wrapper = mountPanel();
    await flush();
    await wrapper.vm.$nextTick();
    const buttons = wrapper.findAll("button");
    const createBtn = buttons.find((b) => b.text().includes("立即备份"))!;
    await createBtn.trigger("click");
    await flush();
    expect(client.createBackup).toHaveBeenCalled();
  });

  it("确认恢复调用 restoreBackup", async () => {
    const wrapper = mountPanel(document.body);
    await flush();
    await wrapper.vm.$nextTick();
    const restoreBtn = wrapper.get(
      '[data-testid="restore-dst-save-20260605-120000.tar.gz"]'
    );
    await restoreBtn.trigger("click");
    const confirm = document.body.querySelector(
      ".n-popconfirm__action .n-button--primary-type"
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    confirm?.click();
    await flush();
    expect(client.restoreBackup).toHaveBeenCalledWith("dst-save-20260605-120000.tar.gz");
  });
});
