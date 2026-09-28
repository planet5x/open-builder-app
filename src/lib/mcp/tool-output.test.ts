import { describe, expect, it } from "vitest";
import {
  mcpSnapshotToToolExecutionOutput,
  mcpToolExecutionOutputToModelOutput,
} from "./tool-output";

describe("MCP rich tool output", () => {
  it("preserves media and resource links without turning links into fetched files", () => {
    const output = mcpSnapshotToToolExecutionOutput(
      {
        isError: false,
        modelText: "fallback",
        truncated: false,
        content: [
          {
            type: "image",
            data: "aGVsbG8=",
            mimeType: "image/png",
            size: 5,
          },
          {
            type: "resource_link",
            uri: "https://example.com/private",
            name: "private result",
          },
        ],
        structuredContent: { count: 1 },
      },
      {
        serverId: "demo",
        serverName: "Demo",
        toolName: "render",
      },
    );

    expect(output.source).toMatchObject({
      kind: "mcp",
      serverName: "Demo",
      toolName: "render",
    });
    expect(output.content?.[0]).toMatchObject({
      type: "image",
      data: "aGVsbG8=",
    });
    expect(output.modelOutput).toBeUndefined();
    const modelOutput = mcpToolExecutionOutputToModelOutput(output);
    expect(modelOutput).toMatchObject({ type: "content" });
    const value = (modelOutput as any).value;
    expect(value).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("not fetched"),
      }),
    );
    expect(value).not.toContainEqual(
      expect.objectContaining({
        type: "file",
        data: expect.objectContaining({ type: "url" }),
      }),
    );
  });
});
