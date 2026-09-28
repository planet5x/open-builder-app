import { describe, expect, it } from "vitest";
import { buildMcpToolAliasMap, createMcpToolAlias } from "./alias";
import { MCP_LIMITS } from "./limits";

describe("MCP tool aliases", () => {
  it("creates deterministic provider-safe aliases within the hard limit", () => {
    const first = createMcpToolAlias(
      "a-very-long-server-id-that-will-be-truncated",
      "A tool name with spaces / punctuation and 非 ASCII",
    );
    const second = createMcpToolAlias(
      "a-very-long-server-id-that-will-be-truncated",
      "A tool name with spaces / punctuation and 非 ASCII",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-z0-9_-]+$/);
    expect(first.length).toBeLessThanOrEqual(MCP_LIMITS.maxToolAliasChars);
  });

  it("keeps colliding slugs distinct with a hash of the original identity", () => {
    expect(createMcpToolAlias("服务", "读取")).not.toBe(
      createMcpToolAlias("服務", "讀取"),
    );
    expect(
      Object.keys(
        buildMcpToolAliasMap([
          { serverId: "服务", toolName: "读取" },
          { serverId: "服務", toolName: "讀取" },
        ]),
      ),
    ).toHaveLength(2);
  });
});
