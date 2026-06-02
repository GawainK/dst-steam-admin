import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import ControlPanel from "./ControlPanel.vue";

describe("ControlPanel", () => {
  it("calls the restart action after confirmation", async () => {
    const onRestart = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(ControlPanel, {
      attachTo: document.body,
      props: {
        busyAction: null,
        onStart: vi.fn(),
        onStop: vi.fn(),
        onRestart
      }
    });

    const buttons = wrapper.findAll("button");
    await buttons[2].trigger("click");
    const confirmButton = document.body.querySelector(
      '[data-testid="confirm-restart"]'
    ) as HTMLButtonElement | null;

    expect(confirmButton).not.toBeNull();
    confirmButton?.click();

    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
