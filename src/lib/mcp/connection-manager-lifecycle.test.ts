import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServerEntry } from "./validation";
import {
  beginMcpLifecycleRevocation,
  finishMcpLifecycleRevocation,
} from "./revocation";

const host = vi.hoisted(() => ({
  connectStdio: vi.fn(),
  disconnectStdio: vi.fn(),
}));

const mcpStore = vi.hoisted(() => {
  let state: Record<string, any>;
  const reset = () => {
    state = {
      globalEnabled: true,
      servers: {},
      runtime: {},
      _hasHydrated: true,
      getServer: (id: string) => state.servers[id],
      setRuntimeState: (id: string, patch: Record<string, unknown>) => {
        state.runtime = {
          ...state.runtime,
          [id]: { ...state.runtime[id], ...patch, updatedAt: Date.now() },
        };
      },
    };
  };
  reset();
  return {
    reset,
    api: {
      getState: () => state,
      setState: (
        update:
          | Record<string, unknown>
          | ((current: Record<string, any>) => Record<string, unknown>),
      ) => {
        state = {
          ...state,
          ...(typeof update === "function" ? update(state) : update),
        };
      },
      persist: { rehydrate: vi.fn(async () => {}) },
    },
  };
});

vi.mock("../../store/mcp", () => ({ useMcpStore: mcpStore.api }));

vi.mock("./tauri-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tauri-host")>();
  return {
    ...actual,
    getMcpPlatformCapabilities: vi.fn(async () => ({
      remoteStreaming: false,
      stdio: true,
      oauthLoopback: true,
      skillScripts: true,
      localAgents: true,
    })),
    isTauriMcpHost: vi.fn(() => true),
    connectTauriStdio: host.connectStdio,
    disconnectTauriStdio: host.disconnectStdio,
  };
});

import { McpConnectionManager } from "./connection-manager";
import { useMcpStore } from "../../store/mcp";

describe("MCP connection clear lifecycle", () => {
  let revocation: number | undefined;

  beforeEach(() => {
    host.connectStdio.mockReset();
    host.disconnectStdio.mockReset().mockResolvedValue(undefined);
    mcpStore.reset();
  });

  afterEach(() => {
    if (revocation !== undefined) {
      finishMcpLifecycleRevocation(revocation);
      revocation = undefined;
    }
  });

  it("cannot publish a deferred native connect after full clear begins", async () => {
    let resolveConnect!: (value: { tools: never[] }) => void;
    host.connectStdio.mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    const entry = createMcpServerEntry(
      { name: "Deferred", transport: "stdio", command: "demo-mcp" },
      { id: "deferred", now: 1 },
    );
    useMcpStore.setState({ servers: { deferred: entry } });
    const manager = new McpConnectionManager();

    const connecting = manager.testServer("deferred");
    await vi.waitFor(() => expect(host.connectStdio).toHaveBeenCalledOnce());

    revocation = beginMcpLifecycleRevocation();
    useMcpStore.setState({ servers: {}, runtime: {} });
    resolveConnect({ tools: [] });

    await expect(connecting).resolves.toBeUndefined();
    expect(useMcpStore.getState().runtime).toEqual({});
    expect(host.disconnectStdio).toHaveBeenCalledWith("deferred");
  });
});
