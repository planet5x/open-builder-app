import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: undefined as
    ((event: { payload: Record<string, unknown> }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, listener: typeof tauri.listener) => {
    tauri.listener = listener;
    return tauri.unlisten;
  }),
}));

import {
  clearTauriMcpRemotePolicies,
  connectTauriStdio,
  createTauriMcpFetch,
} from "./tauri-host";
import { createMcpServerEntry } from "./validation";

describe("desktop MCP fetch bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.listener = undefined;
    tauri.unlisten.mockClear();
    tauri.invoke.mockResolvedValue(undefined);
  });

  it("reconstructs a streamed response from bounded native events", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "mcp_remote_policy_epoch") return 7;
      if (command === "mcp_remote_connect") {
        tauri.listener?.({
          payload: {
            type: "Connected",
            status: 200,
            headers: { "content-type": "text/plain" },
          },
        });
        tauri.listener?.({
          payload: { type: "Chunk", sequence: 5, data: [104, 105] },
        });
        tauri.listener?.({ payload: { type: "Done" } });
      }
    });
    const bridge = createTauriMcpFetch("server", ["https://example.com"]);
    const response = await bridge("https://example.com/mcp", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("hi");
    expect(tauri.unlisten).toHaveBeenCalled();
    expect(tauri.invoke).toHaveBeenCalledWith("mcp_remote_ack", {
      id: expect.any(String),
      sequence: 5,
    });
    expect(tauri.invoke).toHaveBeenCalledWith(
      "mcp_remote_connect",
      expect.objectContaining({ serverId: "server", expectedEpoch: 7 }),
    );
  });

  it("rejects an aborted request even when native code emits no response", async () => {
    const controller = new AbortController();
    controller.abort();
    const bridge = createTauriMcpFetch("server", ["https://example.com"]);
    await expect(
      bridge("https://example.com/mcp", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(tauri.invoke).toHaveBeenCalledWith("mcp_remote_disconnect", {
      id: expect.any(String),
    });
  });

  it("does not contact a cross-origin OAuth endpoint without approval", async () => {
    const bridge = createTauriMcpFetch(
      "server",
      ["https://example.com"],
      () => false,
    );
    await expect(bridge("https://login.example.net/token")).rejects.toThrow(
      /not approved/i,
    );
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("marks configured credentials for the native HTTP transport gate", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "mcp_remote_policy_epoch") return 4;
      if (command === "mcp_remote_connect") {
        tauri.listener?.({
          payload: { type: "Connected", status: 204, headers: {} },
        });
        tauri.listener?.({ payload: { type: "Done" } });
      }
    });
    const { setTauriMcpRemotePolicy } = await import("./tauri-host");
    await setTauriMcpRemotePolicy("server", ["http://localhost:8787"], true);
    expect(tauri.invoke).toHaveBeenCalledWith("mcp_remote_set_policy", {
      serverId: "server",
      origins: ["http://localhost:8787"],
      credentialsConfigured: true,
      expectedEpoch: 4,
    });
  });

  it("revokes every native server policy during full clear", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "mcp_platform_capabilities") {
        return {
          remoteStreaming: true,
          stdio: true,
          oauthLoopback: true,
          skillScripts: true,
          localAgents: true,
        };
      }
    });
    await clearTauriMcpRemotePolicies();
    expect(tauri.invoke).toHaveBeenCalledWith("mcp_remote_clear_policies");
    expect(tauri.invoke).toHaveBeenCalledWith("mcp_stdio_disconnect_all");
  });

  it("skips the desktop-only native policy command on mobile", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "mcp_platform_capabilities") {
        return {
          remoteStreaming: false,
          stdio: false,
          oauthLoopback: false,
          skillScripts: false,
          localAgents: false,
        };
      }
    });
    await clearTauriMcpRemotePolicies();
    expect(tauri.invoke).not.toHaveBeenCalledWith("mcp_remote_clear_policies");
    expect(tauri.invoke).not.toHaveBeenCalledWith("mcp_stdio_disconnect_all");
  });

  it("pins stdio setup to the native epoch and honors lifecycle revocation", async () => {
    const entry = createMcpServerEntry(
      { name: "Local", transport: "stdio", command: "demo-mcp" },
      { id: "local", now: 1 },
    );
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "mcp_stdio_connection_epoch") return 3;
      if (command === "mcp_stdio_connect") return { tools: [] };
    });

    await expect(connectTauriStdio(entry, () => true)).resolves.toEqual({
      tools: [],
    });
    expect(tauri.invoke).toHaveBeenCalledWith("mcp_stdio_connect", {
      config: expect.objectContaining({ id: "local", command: "demo-mcp" }),
      expectedEpoch: 3,
    });

    tauri.invoke.mockClear();
    await expect(connectTauriStdio(entry, () => false)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "mcp_stdio_connect",
      expect.anything(),
    );
  });
});
