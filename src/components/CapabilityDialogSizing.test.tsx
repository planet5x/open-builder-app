// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpPanel } from "./mcp/McpPanel";
import { SkillsPanel } from "./skills/SkillsPanel";
import { useMcpStore } from "../store/mcp";
import { useSettingsStore } from "../store/settings";
import { useSkillsStore } from "../store/skills";

describe("capability dialog sizing", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
    useSkillsStore.setState({ skills: {}, _hasHydrated: true });
    useMcpStore.setState({
      servers: {},
      runtime: {},
      globalEnabled: true,
      _hasHydrated: true,
    });
  });

  it("limits the Skills dialog to 576px", () => {
    render(<SkillsPanel open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-xl");
  });

  it("limits the MCP dialog to 576px", () => {
    render(<McpPanel open onClose={vi.fn()} platform="web" />);

    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-xl");
  });
});
