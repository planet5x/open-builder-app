import { jsonSchema, tool, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  serializeLocalToolSet,
  validateLocalToolArguments,
} from "./tool-schema";

const tools: ToolSet = {
  read_files: tool({
    description: "Read project files",
    inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
  }),
  screenshot_to_code: tool({
    description: "API-only image conversion",
    inputSchema: z.object({ attachmentId: z.string() }),
  }),
};

describe("local-agent tool schemas", () => {
  it("serializes the shared schema and omits explicitly unavailable tools", async () => {
    const serialized = await serializeLocalToolSet(
      tools,
      new Set(["screenshot_to_code"]),
    );

    expect(serialized).toHaveLength(1);
    expect(serialized[0]).toMatchObject({
      name: "read_files",
      description: "Read project files",
      inputSchema: {
        type: "object",
        required: ["paths"],
      },
    });
  });

  it("validates every CLI tool call with the original shared schema", async () => {
    await expect(
      validateLocalToolArguments(tools, "read_files", {
        paths: ["src/App.tsx"],
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      validateLocalToolArguments(tools, "read_files", { paths: [] }),
    ).resolves.toMatchObject({ success: false });
    await expect(
      validateLocalToolArguments(tools, "unknown_tool", {}),
    ).resolves.toMatchObject({
      success: false,
      error: expect.objectContaining({
        message: expect.stringContaining("not authorized"),
      }),
    });
  });

  it("fails closed when a raw JSON Schema has no executable validator", async () => {
    const rawTools: ToolSet = {
      remote_tool: tool({
        description: "Unvalidated remote tool",
        inputSchema: jsonSchema({
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        }),
      }),
    };

    await expect(
      validateLocalToolArguments(rawTools, "remote_tool", { id: "1" }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.objectContaining({
        message: expect.stringMatching(/no enforceable input validator/i),
      }),
    });
  });
});
