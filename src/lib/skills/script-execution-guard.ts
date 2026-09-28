import type { ScriptExecuteParams, ScriptResult } from "./script-executor";

export const SCRIPT_EXECUTION_LIMITS = {
  maxScriptBytes: 256 * 1024,
  maxArgCount: 32,
  maxArgBytes: 8 * 1024,
  maxOutputChars: 64 * 1024,
} as const;

function textBytes(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function truncateText(
  value: string,
  maxChars: number,
): {
  text: string;
  truncated: boolean;
} {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

export function validateScriptExecuteParams(params: ScriptExecuteParams): void {
  if (!params.runId.trim() || !params.callId.trim()) {
    throw new Error("run and call ids are required");
  }
  if (
    textBytes(params.scriptContent) > SCRIPT_EXECUTION_LIMITS.maxScriptBytes
  ) {
    throw new Error(
      `script exceeds ${SCRIPT_EXECUTION_LIMITS.maxScriptBytes} bytes`,
    );
  }
  if (params.args.length > SCRIPT_EXECUTION_LIMITS.maxArgCount) {
    throw new Error(
      `too many script args (max ${SCRIPT_EXECUTION_LIMITS.maxArgCount})`,
    );
  }
  const oversizedArg = params.args.find(
    (arg) => textBytes(arg) > SCRIPT_EXECUTION_LIMITS.maxArgBytes,
  );
  if (oversizedArg !== undefined) {
    throw new Error(
      `script args must be <= ${SCRIPT_EXECUTION_LIMITS.maxArgBytes} bytes each`,
    );
  }
}

export function normalizeScriptResult(result: ScriptResult): ScriptResult {
  const stdout = truncateText(
    result.stdout,
    SCRIPT_EXECUTION_LIMITS.maxOutputChars,
  );
  const stderr = truncateText(
    result.stderr,
    SCRIPT_EXECUTION_LIMITS.maxOutputChars,
  );
  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: result.stdoutTruncated || stdout.truncated,
    stderrTruncated: result.stderrTruncated || stderr.truncated,
  };
}
