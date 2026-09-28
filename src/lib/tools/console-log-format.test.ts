import { describe, expect, it } from "vitest";
import {
  CONSOLE_LOG_LIMITS,
  formatConsoleLogLine,
  formatConsoleLogs,
  stringifyConsoleItem,
} from "./console-log-format";

describe("console log formatting", () => {
  it("safely stringifies circular values", () => {
    const circular: Record<string, unknown> = { label: "loop" };
    circular.self = circular;

    expect(stringifyConsoleItem(circular)).toContain("[object Object]");
  });

  it("limits items and item length per log line", () => {
    const line = formatConsoleLogLine({
      method: "error",
      data: [
        "x".repeat(CONSOLE_LOG_LIMITS.maxItemChars + 10),
        ...Array.from(
          { length: CONSOLE_LOG_LIMITS.maxItemsPerLog + 2 },
          (_, i) => i,
        ),
      ],
    });

    expect(line).toContain("[ERROR]");
    expect(line).toContain("[truncated]");
    expect(line).toContain("more item(s)");
  });

  it("limits the number of logs and total output size", () => {
    const logs = Array.from(
      { length: CONSOLE_LOG_LIMITS.maxLogs + 5 },
      (_, i) => ({
        method: "log",
        data: [`entry ${i}`, "x".repeat(CONSOLE_LOG_LIMITS.maxOutputChars)],
      }),
    );

    const output = formatConsoleLogs(logs);

    expect(output).toContain(
      `showing last ${CONSOLE_LOG_LIMITS.maxLogs} of ${logs.length}`,
    );
    expect(output).toContain("[truncated]");
    expect(output).not.toContain("entry 0");
  });

  it("redacts credentials before console output reaches a model or history", () => {
    const sentinel = "console-secret-sentinel";
    const output = formatConsoleLogs([
      {
        method: "error",
        data: [`Authorization: Bearer ${sentinel}`, `API_TOKEN=${sentinel}`],
      },
    ]);

    expect(output).not.toContain(sentinel);
    expect(output).toContain("[REDACTED]");
  });
});
