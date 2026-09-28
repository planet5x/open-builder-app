import { describe, expect, it } from "vitest";
import {
  compileMcpToolInputValidator,
  validateMcpToolInput,
} from "./tool-input-validator";

describe("MCP tool input validation", () => {
  const schema = {
    type: "object",
    properties: { count: { type: "integer", default: 2 } },
    required: ["count"],
    additionalProperties: false,
  };

  it("validates without coercing, defaulting, or removing input fields", async () => {
    const validInput = { count: 1 };
    const validate = await compileMcpToolInputValidator(schema);

    const accepted = validate(validInput);
    expect(accepted).toEqual({ success: true, value: validInput });
    if (accepted.success) expect(accepted.value).toBe(validInput);

    const coercionCandidate = { count: "1", extra: true };
    expect(validate(coercionCandidate)).toMatchObject({ success: false });
    expect(coercionCandidate).toEqual({ count: "1", extra: true });

    const defaultCandidate: Record<string, unknown> = {};
    expect(validate(defaultCandidate)).toMatchObject({ success: false });
    expect(defaultCandidate).toEqual({});
  });

  it("fails closed for unsupported schemas", async () => {
    await expect(
      validateMcpToolInput(
        {
          type: "object",
          properties: { value: { $ref: "https://example.com/schema.json" } },
        },
        { value: "x" },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: expect.objectContaining({
        message: expect.stringMatching(/unsupported|resolve reference/i),
      }),
    });
  });

  it("rejects regex schemas before they can block the renderer", async () => {
    await expect(
      compileMcpToolInputValidator({
        type: "object",
        properties: {
          value: { type: "string", pattern: "^(a+)+$" },
        },
      }),
    ).rejects.toThrow(/regular-expression JSON Schema keywords/i);
    await expect(
      compileMcpToolInputValidator({
        type: "object",
        patternProperties: { "^(a+)+$": { type: "string" } },
      }),
    ).rejects.toThrow(/regular-expression JSON Schema keywords/i);
  });

  it("does not confuse a property named pattern with the pattern keyword", async () => {
    const validate = await compileMcpToolInputValidator({
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    });

    expect(validate({ pattern: "plain text" })).toMatchObject({
      success: true,
    });
  });

  it("rejects oversized tool input before schema evaluation", async () => {
    const validate = await compileMcpToolInputValidator({
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    });

    expect(validate({ value: "x".repeat(4 * 1024 * 1024) })).toMatchObject({
      success: false,
      error: expect.objectContaining({
        message: expect.stringMatching(/exceeds/i),
      }),
    });
  });
});
