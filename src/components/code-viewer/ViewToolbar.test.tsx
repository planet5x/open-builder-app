// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip";
import { useSettingsStore } from "../../store/settings";
import { ViewToolbar } from "./ViewToolbar";

describe("ViewToolbar preview availability", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
  });

  it("keeps code actions but removes preview controls in code-only mode", () => {
    render(
      <TooltipProvider>
        <ViewToolbar
          viewMode="code"
          onViewModeChange={vi.fn()}
          deviceSize="desktop"
          onDeviceSizeChange={vi.fn()}
          files={{ "README.md": "notes" }}
          previewEnabled={false}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "Code" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Preview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Desktop" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
  });
});
