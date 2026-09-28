// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../ui/tooltip";
import { useSettingsStore } from "../../../store/settings";
import { aiDefaults } from "../../../store/settings/ai";
import { systemDefaults } from "../../../store/settings/system";
import { ModelTab } from "./ModelTab";
import { DEFAULT_OPENAI_MODEL } from "../../../lib/ai/provider-config";

describe("ModelTab local-agent capability", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    useSettingsStore.setState({
      system: { ...systemDefaults, language: "en" },
    });
  });

  it("shows capability errors and retries explicitly", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => "error" as const);
    useSettingsStore.setState({
      localAgentCapability: "error",
      refreshLocalAgentCapability: refresh,
    });

    render(
      <TooltipProvider>
        <ModelTab
          formData={{ ...aiDefaults, runtime: "localCli" }}
          setFormData={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("CLI unavailable");
    await user.click(screen.getByRole("button", { name: "Rescan" }));
    expect(refresh).toHaveBeenCalledWith(true);
  });

  it("distinguishes loading and unsupported platforms", () => {
    const refresh = vi.fn(() => new Promise<"supported">(() => undefined));
    useSettingsStore.setState({
      localAgentCapability: "loading",
      refreshLocalAgentCapability: refresh,
    });
    const { rerender } = render(
      <TooltipProvider>
        <ModelTab
          formData={{ ...aiDefaults, runtime: "localCli" }}
          setFormData={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Detecting local CLI");

    act(() => {
      useSettingsStore.setState({ localAgentCapability: "unsupported" });
    });
    rerender(
      <TooltipProvider>
        <ModelTab
          formData={{ ...aiDefaults, runtime: "localCli" }}
          setFormData={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Local CLI is desktop-only",
    );
  });

  it("sets the OpenAI-family default when the API type changes", async () => {
    const user = userEvent.setup();
    const setFormData = vi.fn();
    useSettingsStore.setState({ localAgentCapability: "unsupported" });
    render(
      <TooltipProvider>
        <ModelTab
          formData={{
            ...aiDefaults,
            apiType: "anthropic",
            apiBaseUrl: "https://api.anthropic.com",
            model: "claude-custom",
          }}
          setFormData={setFormData}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("combobox", { name: "API Type" }));
    await user.click(
      screen.getByRole("option", { name: /OpenAI Compatible/i }),
    );

    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        apiType: "openai-compatible",
        apiBaseUrl: "http://localhost:11434",
        model: DEFAULT_OPENAI_MODEL,
      }),
    );
  });

  it("hides the runtime setting when web only supports API", () => {
    useSettingsStore.setState({ localAgentCapability: "unsupported" });

    render(
      <TooltipProvider>
        <ModelTab formData={aiDefaults} setFormData={vi.fn()} />
      </TooltipProvider>,
    );

    expect(
      screen.queryByRole("group", { name: "Runtime" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "API Type" })).toBeVisible();
  });

  it("keeps the runtime setting when local agents are supported", () => {
    useSettingsStore.setState({ localAgentCapability: "supported" });

    render(
      <TooltipProvider>
        <ModelTab formData={aiDefaults} setFormData={vi.fn()} />
      </TooltipProvider>,
    );

    const runtime = screen.getByRole("group", { name: "Runtime" });
    expect(runtime).toBeVisible();
    expect(runtime).toHaveTextContent("API");
    expect(runtime).toHaveTextContent("Local CLI");
  });
});
