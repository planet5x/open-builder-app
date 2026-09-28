// @vitest-environment jsdom

import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LocalAgentAvailability,
  LocalAgentModel,
  LocalAgentProvider,
} from "../../../lib/local-agent/types";
import { useSettingsStore } from "../../../store/settings";
import { aiDefaults } from "../../../store/settings/ai";
import type { AISettings } from "../../../store/settings/ai";
import { systemDefaults } from "../../../store/settings/system";
import { LocalAgentSettings } from "./LocalAgentSettings";

const localAgentMocks = vi.hoisted(() => ({
  probe: vi.fn(),
  choose: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("../../../lib/local-agent/tauri", () => ({
  probeLocalAgent: localAgentMocks.probe,
  chooseLocalAgentExecutable: localAgentMocks.choose,
  clearLocalAgentExecutable: localAgentMocks.clear,
}));

function probe(
  availability: LocalAgentAvailability,
  provider: LocalAgentProvider = "codex",
  models: LocalAgentModel[] = [],
) {
  return {
    provider,
    availability,
    path:
      availability === "notFound" ? undefined : `/usr/local/bin/${provider}`,
    pathSource: "path" as const,
    version: `${provider} 1.0.0`,
    authenticated: availability === "ready",
    loginCommand: `${provider} login`,
    models,
    efforts: [],
    capabilities: [],
    message:
      availability === "unsupported"
        ? "Protocol isolation unavailable"
        : undefined,
  };
}

function Harness({
  supported = true,
  initialSettings,
}: {
  supported?: boolean;
  initialSettings?: AISettings;
}) {
  const [formData, setFormData] = useState<AISettings>(
    initialSettings ?? {
      ...aiDefaults,
      runtime: "localCli" as const,
    },
  );
  return (
    <>
      <LocalAgentSettings
        formData={formData}
        setFormData={setFormData}
        supported={supported}
      />
      <output data-testid="local-agent-state" hidden>
        {JSON.stringify(formData.localAgent)}
      </output>
    </>
  );
}

describe("LocalAgentSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      system: { ...systemDefaults, language: "en" },
    });
  });

  it("blocks local CLI on unsupported platforms without probing", async () => {
    const { container } = render(<Harness supported={false} />);

    expect(screen.getByText("Local CLI is desktop-only")).toBeInTheDocument();
    expect(localAgentMocks.probe).not.toHaveBeenCalled();
    expect((await axe(container)).violations).toEqual([]);
  });

  it.each([
    ["ready", "Installed and signed in"],
    ["signedOut", "Installed, not signed in"],
    ["notFound", "CLI not found"],
    ["unsupported", "CLI unavailable"],
    ["error", "CLI unavailable"],
  ] as const)("renders the %s probe state", async (availability, label) => {
    localAgentMocks.probe.mockResolvedValue(probe(availability));

    render(<Harness />);

    expect(await screen.findByText(label)).toBeInTheDocument();
    if (availability === "signedOut") {
      expect(
        screen.getByRole("button", { name: "Copy login command" }),
      ).toBeInTheDocument();
    }
  });

  it("announces scanning, supports keyboard rescan, and passes axe when ready", async () => {
    const user = userEvent.setup();
    let resolveProbe: ((value: ReturnType<typeof probe>) => void) | undefined;
    localAgentMocks.probe.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const { container } = render(<Harness />);

    expect(await screen.findByText("Detecting local CLI…")).toBeInTheDocument();
    resolveProbe?.(probe("ready"));
    expect(
      await screen.findByText("Installed and signed in"),
    ).toBeInTheDocument();

    localAgentMocks.probe.mockResolvedValue(probe("ready"));
    const rescan = screen.getByRole("button", { name: "Rescan" });
    rescan.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(localAgentMocks.probe).toHaveBeenCalledTimes(2));
    expect((await axe(container)).violations).toEqual([]);
  });

  it("ignores a late probe result after switching providers", async () => {
    const user = userEvent.setup();
    let resolveCodex: ((value: ReturnType<typeof probe>) => void) | undefined;
    let resolveClaude: ((value: ReturnType<typeof probe>) => void) | undefined;
    localAgentMocks.probe.mockImplementation(
      (provider: LocalAgentProvider) =>
        new Promise((resolve) => {
          if (provider === "codex") resolveCodex = resolve;
          else resolveClaude = resolve;
        }),
    );

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Claude" }));
    await waitFor(() =>
      expect(localAgentMocks.probe).toHaveBeenCalledWith("claude"),
    );

    resolveClaude?.(probe("ready", "claude"));
    expect(
      await screen.findByText("/usr/local/bin/claude"),
    ).toBeInTheDocument();

    await act(async () => {
      resolveCodex?.(
        probe("ready", "codex", [
          {
            id: "codex-only",
            displayName: "Codex only",
            isDefault: true,
            efforts: ["high"],
          },
        ]),
      );
      await Promise.resolve();
    });

    expect(screen.getByText("/usr/local/bin/claude")).toBeInTheDocument();
    expect(screen.queryByText("Codex only")).not.toBeInTheDocument();
  });

  it("uses the CLI default model's supported efforts", async () => {
    localAgentMocks.probe.mockResolvedValue(
      probe("ready", "codex", [
        {
          id: "default-model",
          displayName: "Default model",
          isDefault: true,
          efforts: ["medium", "high"],
        },
      ]),
    );

    render(<Harness />);

    expect(
      await screen.findByLabelText("Reasoning effort"),
    ).toBeInTheDocument();
  });

  it("normalizes stale model and effort preferences after a successful probe", async () => {
    localAgentMocks.probe.mockResolvedValue(
      probe("ready", "codex", [
        {
          id: "current-model",
          displayName: "Current model",
          isDefault: true,
          efforts: ["medium", "high"],
        },
      ]),
    );
    render(
      <Harness
        initialSettings={{
          ...aiDefaults,
          runtime: "localCli",
          localAgent: {
            ...aiDefaults.localAgent,
            codex: { model: "removed-model", effort: "ultra" },
          },
        }}
      />,
    );

    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId("local-agent-state").textContent ?? "{}")
          .codex,
      ).toEqual({ model: "", effort: "" }),
    );
  });
});
