// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPermissionActivity,
  getPermissionActivity,
  recordPermissionActivity,
  subscribePermissionActivity,
} from "./activity-log";

describe("permission activity log", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    clearPermissionActivity();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps only an origin and redacts credential-like reason text", () => {
    recordPermissionActivity({
      conversationId: "conversation-a",
      tool: "mcp_demo_search",
      source: "mcp",
      mode: "chat",
      platform: "desktop",
      decision: "denied",
      target: "https://api.example.com/private?token=secret-value",
      reason: "Authorization: Bearer top-secret?key=also-secret",
      mcp: {
        serverId: "demo",
        serverName: "Demo Bearer server-secret",
        toolTitle: "Search?token=tool-secret",
      },
    });

    const [entry] = getPermissionActivity();
    expect(entry.target).toBe("https://api.example.com");
    expect(entry.reason).toContain("Bearer [REDACTED]");
    expect(JSON.stringify(entry)).not.toContain("top-secret");
    expect(JSON.stringify(entry)).not.toContain("also-secret");
    expect(JSON.stringify(entry)).not.toContain("server-secret");
    expect(JSON.stringify(entry)).not.toContain("tool-secret");
  });

  it("filters entries by conversation and excludes legacy unscoped records", () => {
    recordPermissionActivity({
      conversationId: "conversation-a",
      tool: "read_file",
      source: "builtin",
      mode: "chat",
      platform: "web",
      decision: "allowed",
    });
    recordPermissionActivity({
      conversationId: "conversation-b",
      tool: "write_file",
      source: "builtin",
      mode: "chat",
      platform: "web",
      decision: "requested",
    });
    recordPermissionActivity({
      tool: "legacy_tool",
      source: "unknown",
      mode: "chat",
      platform: "web",
      decision: "allowed",
    });

    expect(
      getPermissionActivity("conversation-a").map((entry) => entry.tool),
    ).toEqual(["read_file"]);
    expect(
      getPermissionActivity("conversation-b").map((entry) => entry.tool),
    ).toEqual(["write_file"]);
    expect(getPermissionActivity()).toHaveLength(3);
  });

  it("notifies same-window subscribers after persisted changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePermissionActivity(listener);

    recordPermissionActivity({
      conversationId: "conversation-a",
      tool: "read_file",
      source: "builtin",
      mode: "chat",
      platform: "web",
      decision: "allowed",
    });
    clearPermissionActivity();
    unsubscribe();
    recordPermissionActivity({
      conversationId: "conversation-a",
      tool: "list_files",
      source: "builtin",
      mode: "chat",
      platform: "web",
      decision: "allowed",
    });

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("bounds the local history", () => {
    for (let index = 0; index < 220; index += 1) {
      recordPermissionActivity({
        tool: `tool-${index}`,
        source: "builtin",
        mode: "chat",
        platform: "web",
        decision: "allowed",
      });
    }

    const entries = getPermissionActivity();
    expect(entries).toHaveLength(200);
    expect(entries[0].tool).toBe("tool-20");
    expect(entries.at(-1)?.tool).toBe("tool-219");
  });
});
