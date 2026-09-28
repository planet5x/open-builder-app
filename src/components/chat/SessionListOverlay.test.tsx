// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionListOverlay } from "./SessionListOverlay";

vi.mock("./SessionList", () => ({
  SessionList: () => <nav aria-label="Sessions" />,
}));

describe("SessionListOverlay", () => {
  it("portals a narrow drawer into a full-viewport overlay", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SessionListOverlay closeLabel="Close sessions" onClose={onClose} />,
    );

    const overlay = screen.getByTestId("session-list-overlay");
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay).toHaveClass("fixed", "inset-0");

    const drawer = within(overlay)
      .getByRole("navigation", { name: "Sessions" })
      .closest("aside");
    expect(drawer).toHaveClass("max-w-80");

    await user.click(
      within(overlay).getByRole("button", { name: "Close sessions" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
