import { describe, expect, it } from "vitest";
import { applyMcpServersImport, previewMcpServersImport } from "./importer";
import { createMcpServerEntry } from "./validation";

describe("mcpServers JSON import", () => {
  it("maps URL entries to Streamable HTTP and requires explicit SSE", () => {
    const preview = previewMcpServersImport(
      {
        mcpServers: {
          modern: { url: "https://modern.example.com/mcp" },
          legacy: {
            url: "https://legacy.example.com/sse",
            transport: "sse",
          },
        },
      },
      { platform: "web" },
    );

    expect(preview.errorCount).toBe(0);
    expect(
      preview.candidates.map((candidate) => candidate.config?.transport),
    ).toEqual(["streamable-http", "sse"]);
  });

  it("reports unknown fields and literal placeholders without hiding them", () => {
    const preview = previewMcpServersImport(
      {
        extraRoot: true,
        mcpServers: {
          remote: {
            url: "https://example.com/${MCP_PATH}",
            headers: { Authorization: "Bearer ${MCP_TOKEN}" },
            invented: true,
          },
        },
      },
      { platform: "web" },
    );

    const allIssues = [
      ...preview.issues,
      ...preview.candidates.flatMap((candidate) => candidate.issues),
    ];
    expect(allIssues.some((item) => item.code === "unknown_field")).toBe(true);
    expect(
      allIssues.filter((item) => item.code === "placeholder").length,
    ).toBeGreaterThan(0);
    expect(preview.candidates[0].config?.headers?.Authorization).toBe(
      "Bearer ${MCP_TOKEN}",
    );
  });

  it("rejects stdio on web but accepts it on desktop", () => {
    const input = {
      mcpServers: {
        local: { command: "node", args: ["server.mjs"] },
      },
    };
    expect(
      previewMcpServersImport(input, { platform: "web" }).errorCount,
    ).toBeGreaterThan(0);
    expect(
      previewMcpServersImport(input, { platform: "desktop" }).errorCount,
    ).toBe(0);
  });

  it("defaults conflicts to skip and replacement clears approval", () => {
    const existing = createMcpServerEntry(
      {
        name: "Remote",
        transport: "streamable-http",
        url: "https://old.example.com/mcp",
      },
      { id: "remote", now: 1 },
    );
    existing.approvedAt = 2;
    existing.definitionFingerprint = "old";
    const preview = previewMcpServersImport(
      { mcpServers: { Remote: { url: "https://new.example.com/mcp" } } },
      { platform: "web", existingServers: { remote: existing } },
    );
    expect(preview.candidates[0]).toMatchObject({
      conflict: "existing",
      action: "skip",
      valid: true,
    });

    preview.candidates[0].action = "replace";
    const applied = applyMcpServersImport(preview, { remote: existing }, 10);
    expect(applied.servers.remote).toMatchObject({
      id: "remote",
      enabled: false,
      url: "https://new.example.com/mcp",
      tools: {},
      createdAt: 1,
      updatedAt: 10,
    });
    expect(applied.servers.remote.approvedAt).toBeUndefined();
  });
});
