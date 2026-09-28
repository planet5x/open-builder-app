import type { ToolExecutionOutput } from "../ai/generator-types";
import {
  ASK_USER_ANSWERS_KIND,
  type AskUserAnswersStructuredContent,
} from "./tool-result";
import {
  isSensitiveProjectPath,
  redactProjectFileSecrets,
} from "./project-file-policy";

export const REDACTED_VALUE = "[REDACTED]";
const OMITTED_PROTECTED_RESULT =
  "[Protected tool result omitted from persisted conversation replay]";

export function redactSensitiveText(text: string): string {
  return redactProjectFileSecrets(text)
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      REDACTED_VALUE,
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/._~=-]+/gi, `$1 ${REDACTED_VALUE}`)
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|auth|key|password|secret|token)=)[^&#\s]*/gi,
      `$1${REDACTED_VALUE}`,
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|authorization|client[_-]?secret|password|private[_-]?key|secret|token)\s*[=:]\s*["']?)([^\s,"'\]}]+)/gi,
      `$1${REDACTED_VALUE}`,
    )
    .replace(
      /^([A-Z_][A-Z0-9_]*(?:API_KEY|CREDENTIAL|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)[A-Z0-9_]*)\s*=.*$/gim,
      `$1=${REDACTED_VALUE}`,
    );
}

function parseArguments(raw: string | unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function sanitizeToolArguments(
  toolName: string,
  raw: string | unknown,
): unknown {
  const parsed = parseArguments(raw);
  if (toolName !== "manage_env" || !parsed || typeof parsed !== "object") {
    return parsed;
  }
  const record = parsed as Record<string, unknown>;
  const operations = Array.isArray(record.operations)
    ? record.operations.map((operation) => {
        if (!operation || typeof operation !== "object") return operation;
        const safe = { ...(operation as Record<string, unknown>) };
        if ("value" in safe) safe.value = REDACTED_VALUE;
        return safe;
      })
    : record.operations;
  return { ...record, operations };
}

export function serializeToolArgumentsForHistory(
  toolName: string,
  args: unknown,
): string {
  return JSON.stringify(sanitizeToolArguments(toolName, args));
}

function readsProtectedFiles(
  toolName: string,
  rawArguments: string | unknown,
): boolean {
  if (toolName !== "read_files") return false;
  const parsed = parseArguments(rawArguments);
  if (!parsed || typeof parsed !== "object") return false;
  const paths = (parsed as { paths?: unknown }).paths;
  return (
    Array.isArray(paths) &&
    paths.some(
      (path) => typeof path === "string" && isSensitiveProjectPath(path),
    )
  );
}

function stripProtectedSearchLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const match = /^(.+?):\d+:/.exec(line);
      return !match || !isSensitiveProjectPath(match[1]);
    })
    .join("\n");
}

export function sanitizeToolResultForHistory(
  toolName: string,
  rawArguments: string | unknown,
  result: string,
): string {
  if (readsProtectedFiles(toolName, rawArguments)) {
    return OMITTED_PROTECTED_RESULT;
  }
  const withoutProtectedSearchLines =
    toolName === "search_in_files" ? stripProtectedSearchLines(result) : result;
  return redactSensitiveText(withoutProtectedSearchLines);
}

export function shouldOmitRichToolOutput(
  toolName: string,
  rawArguments: string | unknown,
): boolean {
  return (
    readsProtectedFiles(toolName, rawArguments) ||
    toolName === "get_console_logs" ||
    toolName === "project_health_check"
  );
}

function sanitizeAskUserAnswersStructuredContent(
  value: unknown,
): AskUserAnswersStructuredContent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AskUserAnswersStructuredContent>;
  if (
    candidate.kind !== ASK_USER_ANSWERS_KIND ||
    !Array.isArray(candidate.selections) ||
    !candidate.selections.every(
      (selection) =>
        Array.isArray(selection) &&
        selection.every((answer) => typeof answer === "string"),
    )
  ) {
    return undefined;
  }
  return {
    kind: ASK_USER_ANSWERS_KIND,
    selections: candidate.selections.map((selection) =>
      selection.map(redactSensitiveText),
    ),
  };
}

export function sanitizeToolExecutionOutputForHistory(
  toolName: string,
  rawArguments: string | unknown,
  output: ToolExecutionOutput | undefined,
): ToolExecutionOutput | undefined {
  if (!output) return undefined;
  const text = sanitizeToolResultForHistory(
    toolName,
    rawArguments,
    output.text,
  );
  if (shouldOmitRichToolOutput(toolName, rawArguments)) {
    return {
      text,
      isError: output.isError,
      source: output.source,
      modelOutput: { type: "text", value: text },
    };
  }
  if (toolName === "ask_user_question") {
    const structuredContent = sanitizeAskUserAnswersStructuredContent(
      output.structuredContent,
    );
    const { structuredContent: _structuredContent, ...safeOutput } = output;
    return {
      ...safeOutput,
      text,
      ...(structuredContent ? { structuredContent } : {}),
      modelOutput: { type: "text", value: text },
    };
  }
  return { ...output, text };
}
