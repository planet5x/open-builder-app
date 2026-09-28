// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import { CapsuleGroup } from "./capsule-group";

const options = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

describe("CapsuleGroup", () => {
  it("exposes selection semantics and supports pointer/keyboard activation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <CapsuleGroup
        label="Appearance"
        value="dark"
        onChange={onChange}
        options={options}
      />,
    );

    expect(screen.getByRole("group", { name: "Appearance" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(onChange).toHaveBeenCalledWith("light");

    screen.getByRole("button", { name: "System" }).focus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("system");
    expect(
      (
        await axe(container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
});
