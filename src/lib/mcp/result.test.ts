import { describe, expect, it } from "vitest";
import { normalizeMcpToolResult } from "./result";

describe("MCP tool result normalization", () => {
  it("preserves rich blocks and creates a deterministic text fallback", () => {
    const snapshot = normalizeMcpToolResult(
      {
        content: [
          { type: "text", text: "hello" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          {
            type: "resource_link",
            uri: "docs://guide",
            name: "Guide",
          },
        ],
        structuredContent: { count: 3 },
      },
      { serverId: "demo", serverName: "Demo", toolName: "inspect" },
    );

    expect(snapshot).toMatchObject({
      serverId: "demo",
      toolName: "inspect",
      isError: false,
      structuredContent: { count: 3 },
      truncated: false,
    });
    expect(snapshot.content[1]).toMatchObject({
      type: "image",
      size: 5,
      data: "aGVsbG8=",
    });
    expect(snapshot.modelText).toContain("hello");
    expect(snapshot.modelText).toContain("not fetched");
    expect(snapshot.modelText).not.toContain("aGVsbG8=");
  });

  it("keeps an explicit placeholder when binary content exceeds limits", () => {
    const snapshot = normalizeMcpToolResult(
      {
        content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
      },
      { limits: { maxImageBytes: 4 } },
    );

    expect(snapshot.content[0]).toMatchObject({
      type: "image",
      size: 5,
      omitted: true,
    });
    expect(snapshot.modelText).toContain("omitted");
    expect(snapshot.truncated).toBe(true);
  });

  it("truncates text and omits invalid structured data instead of failing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const snapshot = normalizeMcpToolResult(
      {
        content: [{ type: "text", text: "abcdef" }],
        structuredContent: cyclic,
      },
      { limits: { maxTextBytes: 3 } },
    );

    expect(snapshot.content[0]).toMatchObject({
      type: "text",
      truncated: true,
    });
    expect(snapshot.structuredContentOmitted).toBe(true);
    expect(snapshot.modelText).toContain("structured content omitted");
  });
});
