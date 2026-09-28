import { describe, expect, it } from "vitest";
import { CONSOLE_LOG_LIMITS } from "../lib/tools/console-log-format";
import { normalizeConsoleLogs } from "./sandpack";

describe("sandpack console log store guards", () => {
  it("keeps only bounded, stringified console log data", () => {
    const circular: Record<string, unknown> = { label: "loop" };
    circular.self = circular;
    const logs = Array.from(
      { length: CONSOLE_LOG_LIMITS.maxLogs + 10 },
      (_, i) => ({
        method: i % 2 === 0 ? "log" : "error",
        id: `log-${i}`,
        data: [
          "x".repeat(CONSOLE_LOG_LIMITS.maxItemChars + 20),
          circular,
          ...Array.from(
            { length: CONSOLE_LOG_LIMITS.maxItemsPerLog + 5 },
            (_, item) => ({ item }),
          ),
        ],
      }),
    );

    const normalized = normalizeConsoleLogs(logs);

    expect(normalized).toHaveLength(CONSOLE_LOG_LIMITS.maxLogs);
    expect(normalized[0].id).toBe("log-10");
    expect(normalized[0].data).toHaveLength(CONSOLE_LOG_LIMITS.maxItemsPerLog);
    expect(String(normalized[0].data[0]).length).toBeLessThanOrEqual(
      CONSOLE_LOG_LIMITS.maxItemChars,
    );
    expect(normalized[0].data.every((item) => typeof item === "string")).toBe(
      true,
    );
  });
});
