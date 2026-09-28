// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip";
import { useSnapshotStore } from "../../store/snapshot";
import { useSettingsStore } from "../../store/settings";
import { DiffModal } from "./DiffModal";

const originalSystem = useSettingsStore.getState().system;

describe("DiffModal", () => {
  beforeEach(() => {
    useSettingsStore.getState().setSystem({
      ...originalSystem,
      language: "en",
    });
    useSnapshotStore.setState({
      snapshots: {
        conversation: [
          {
            id: "snapshot",
            conversationId: "conversation",
            messageId: "message",
            patches: {},
            addedFiles: { "src/index.ts": "export const value = 1;\n" },
            deletedFiles: [],
            createdAt: 1,
            kind: "checkpoint",
            fullFiles: { "src/index.ts": "export const value = 1;\n" },
          },
        ],
      },
      _hasHydrated: true,
    });
  });

  afterEach(() => {
    useSettingsStore.getState().setSystem(originalSystem);
  });

  function renderModal(onClose = vi.fn()) {
    const rendered = render(
      <TooltipProvider>
        <DiffModal
          conversationId="conversation"
          messageId="message"
          onClose={onClose}
        />
      </TooltipProvider>,
    );
    return { ...rendered, onClose };
  }

  it("keeps the localized close control in the header flow", async () => {
    const user = userEvent.setup();
    const { baseElement, onClose } = renderModal();
    const close = screen.getByRole("button", { name: "Close code changes" });
    const header = baseElement.querySelector('[data-slot="dialog-header"]');

    expect(header).toContainElement(close);
    expect(baseElement.querySelector('[data-slot="dialog-close"]')).toBeNull();
    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and passes axe checks", async () => {
    const user = userEvent.setup();
    const { baseElement, onClose } = renderModal();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      (
        await axe(baseElement, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const { baseElement, onClose } = renderModal();
    const overlay = baseElement.querySelector('[data-slot="dialog-overlay"]');
    if (!(overlay instanceof HTMLElement)) {
      throw new Error("Expected dialog overlay");
    }

    await user.click(overlay);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
