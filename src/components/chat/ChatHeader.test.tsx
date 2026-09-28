// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip";
import { useSettingsStore } from "../../store/settings";
import { ChatHeader } from "./ChatHeader";

function renderHeader(
  permissionActivityCount: number,
  onOpenPermissionActivity = vi.fn(),
) {
  render(
    <TooltipProvider>
      <ChatHeader
        isGenerating={false}
        onOpenSettings={vi.fn()}
        onToggleSessionList={vi.fn()}
        onOpenPermissionActivity={onOpenPermissionActivity}
        onOpenSnapshotHistory={vi.fn()}
        permissionActivityCount={permissionActivityCount}
        snapshotCount={0}
      />
    </TooltipProvider>,
  );
  return onOpenPermissionActivity;
}

describe("ChatHeader permission activity", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
  });

  it("disables the permission activity button when the session has no entries", () => {
    renderHeader(0);

    expect(
      screen.getByRole("button", { name: "View permission activity" }),
    ).toBeDisabled();
  });

  it("opens permission activity when the current session has entries", async () => {
    const user = userEvent.setup();
    const onOpen = renderHeader(1);

    await user.click(
      screen.getByRole("button", { name: "View permission activity" }),
    );
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
