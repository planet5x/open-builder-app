import { describe, expect, it } from "vitest";
import type { McpToolDefinition } from "./types";
import {
  approveMcpDiscovery,
  canonicalMcpJson,
  compareMcpDiscovery,
  fingerprintMcpTool,
} from "./fingerprint";
import { createMcpServerEntry } from "./validation";
import { TOOL_POLICY_VERSION } from "../ai/tool-policy-version";

function tool(overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
  return {
    name: "read_file",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    annotations: { readOnlyHint: true },
    ...overrides,
  };
}

describe("MCP definition fingerprints", () => {
  it("canonicalizes object keys but preserves array order", async () => {
    expect(canonicalMcpJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalMcpJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    await expect(fingerprintMcpTool(tool())).resolves.toBe(
      await fingerprintMcpTool(
        tool({
          inputSchema: {
            required: ["path"],
            properties: { path: { type: "string" } },
            type: "object",
          },
        }),
      ),
    );
  });

  it("reports added, removed, changed, and instruction drift", async () => {
    const base = createMcpServerEntry(
      {
        name: "Files",
        transport: "streamable-http",
        url: "https://mcp.example.com",
      },
      { id: "files", now: 10 },
    );
    const approved = await approveMcpDiscovery(
      base,
      { instructions: "Use carefully", tools: [tool(), tool({ name: "old" })] },
      { now: 20 },
    );
    const report = await compareMcpDiscovery(approved, {
      instructions: "Different instructions",
      tools: [tool({ description: "Changed" }), tool({ name: "new" })],
    });

    expect(report).toMatchObject({
      status: "drifted",
      added: ["new"],
      removed: ["old"],
      changed: ["read_file"],
      instructionsChanged: true,
    });
  });

  it("preserves unchanged permissions and clears them for changed definitions", async () => {
    const base = createMcpServerEntry(
      {
        name: "Files",
        transport: "streamable-http",
        url: "https://mcp.example.com",
      },
      { id: "files", now: 10 },
    );
    const approved = await approveMcpDiscovery(base, { tools: [tool()] });
    approved.tools.read_file.allowInPlanMode = true;
    approved.tools.read_file.allowForSubagents = true;
    approved.tools.read_file.elevatedPermissionsPolicyVersion =
      TOOL_POLICY_VERSION;

    const unchanged = await approveMcpDiscovery(approved, { tools: [tool()] });
    expect(unchanged.tools.read_file.allowInPlanMode).toBe(true);
    expect(unchanged.tools.read_file.elevatedPermissionsPolicyVersion).toBe(
      TOOL_POLICY_VERSION,
    );
    const changed = await approveMcpDiscovery(unchanged, {
      tools: [tool({ description: "Changed" })],
    });
    expect(changed.tools.read_file).toMatchObject({
      allowInPlanMode: false,
      allowForSubagents: false,
    });
  });
});
