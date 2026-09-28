// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { webSearchDefaults } from "../../../store/settings/web-search";
import { useSettingsStore } from "../../../store/settings";
import { WebSearchTab } from "./WebSearchTab";

describe("WebSearchTab", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
  });

  it("presents Firecrawl as keyless with an optional higher-limit key", () => {
    render(
      <WebSearchTab
        form={webSearchDefaults}
        setForm={vi.fn()}
        apiType="openai-compatible"
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Web search" }),
    ).toHaveTextContent("Firecrawl");
    expect(screen.getByLabelText("Firecrawl API Key")).toBeVisible();
    expect(screen.getByText(/IP-limited free allowance/i)).toBeVisible();
  });

  it("shows a required key field for Exa", () => {
    render(
      <WebSearchTab
        form={{ ...webSearchDefaults, engine: "exa" }}
        setForm={vi.fn()}
        apiType="openai-compatible"
      />,
    );

    expect(screen.getByLabelText("Exa API Key")).toBeVisible();
    expect(screen.getByText(/Required.*enable Exa/i)).toBeVisible();
  });
});
