import { describe, expect, it } from "vitest";
import {
  normalizeScriptResult,
  SCRIPT_EXECUTION_LIMITS,
  validateScriptExecuteParams,
} from "./script-execution-guard";

const baseParams = {
  skillId: "skill-1",
  skillName: "Demo",
  skillSource: "imported" as const,
  runId: "run-1",
  callId: "call-1",
  scriptPath: "hello.js",
  scriptContent: "console.log('ok')",
  args: [],
};

describe("script execution guard", () => {
  it("rejects oversized scripts and args before execution", () => {
    expect(() =>
      validateScriptExecuteParams({
        ...baseParams,
        scriptContent: "x".repeat(SCRIPT_EXECUTION_LIMITS.maxScriptBytes + 1),
      }),
    ).toThrow("script exceeds");

    expect(() =>
      validateScriptExecuteParams({
        ...baseParams,
        args: Array.from(
          { length: SCRIPT_EXECUTION_LIMITS.maxArgCount + 1 },
          () => "x",
        ),
      }),
    ).toThrow("too many script args");

    expect(() =>
      validateScriptExecuteParams({
        ...baseParams,
        args: ["x".repeat(SCRIPT_EXECUTION_LIMITS.maxArgBytes + 1)],
      }),
    ).toThrow("script args must be <=");
  });

  it("truncates long stdout and stderr", () => {
    const result = normalizeScriptResult({
      exitCode: 0,
      stdout: "o".repeat(SCRIPT_EXECUTION_LIMITS.maxOutputChars + 5),
      stderr: "e".repeat(SCRIPT_EXECUTION_LIMITS.maxOutputChars + 5),
    });

    expect(result.stdout).toHaveLength(SCRIPT_EXECUTION_LIMITS.maxOutputChars);
    expect(result.stderr).toHaveLength(SCRIPT_EXECUTION_LIMITS.maxOutputChars);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
  });
});
