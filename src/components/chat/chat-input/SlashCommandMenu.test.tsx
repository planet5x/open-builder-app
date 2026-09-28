// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandMenu } from "./SlashCommandMenu";

describe("SlashCommandMenu", () => {
  it("labels the menu, exposes selection, and invokes mouse actions", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onHoverIdx = vi.fn();
    const { container } = render(
      <SlashCommandMenu
        commands={["clear", "reset"]}
        selectedIdx={1}
        onSelect={onSelect}
        onHoverIdx={onHoverIdx}
      />,
    );

    const items = screen.getAllByRole("menuitem");
    expect(items[1]).toHaveAttribute("aria-current", "true");
    await user.hover(items[0]);
    expect(onHoverIdx).toHaveBeenCalledWith(0);
    await user.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith("reset");
    expect(
      (
        await axe(container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
});
