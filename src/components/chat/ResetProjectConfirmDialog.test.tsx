// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { ResetProjectConfirmDialog } from "./ResetProjectConfirmDialog";

describe("ResetProjectConfirmDialog", () => {
  it("requires an explicit destructive confirmation and remains accessible", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <ResetProjectConfirmDialog onCancel={onCancel} onConfirm={onConfirm} />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName();
    await user.click(
      screen.getByRole("button", { name: /reset project|重置项目/i }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      (
        await axe(container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ResetProjectConfirmDialog onCancel={onCancel} onConfirm={vi.fn()} />,
    );

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
