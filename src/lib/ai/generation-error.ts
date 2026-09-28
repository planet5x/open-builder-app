import type {
  StructuredGenerationError,
  StructuredGenerationErrorKind,
} from "./generator-types";
import type { Translations } from "../../i18n";

const KIND_PATTERNS: Array<{
  kind: StructuredGenerationErrorKind;
  retryable: boolean;
  pattern: RegExp;
}> = [
  {
    kind: "context_length",
    retryable: true,
    pattern: /context_length_exceeded|context length|maximum context/i,
  },
  {
    kind: "auth",
    retryable: false,
    pattern: /api key|unauthorized|forbidden|invalid key|permission/i,
  },
  {
    kind: "network",
    retryable: true,
    pattern: /network|fetch|timeout|timed out|failed to fetch/i,
  },
  {
    kind: "tool",
    retryable: true,
    pattern: /tool|invalid arguments|schema|tool call/i,
  },
  {
    kind: "runtime_check",
    retryable: true,
    pattern: /automatic qa|runtime check|health check|project_health_check/i,
  },
];

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "Unknown error";
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Unknown error";
}

function getErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object" || !("status" in err)) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function classifyGenerationError(
  err: unknown,
): StructuredGenerationError {
  const message = getErrorMessage(err);
  const status = getErrorStatus(err);

  if (err && typeof err === "object" && (err as { name?: unknown }).name === "AbortError") {
    return { kind: "aborted", message, retryable: false, status };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", message, retryable: false, status };
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return { kind: "model", message, retryable: true, status };
  }

  for (const candidate of KIND_PATTERNS) {
    if (candidate.pattern.test(message)) {
      return {
        kind: candidate.kind,
        message,
        retryable: candidate.retryable,
        status,
      };
    }
  }

  return { kind: "unknown", message, retryable: true, status };
}

export function formatGenerationErrorMessage(
  error: StructuredGenerationError,
  t: Translations,
): string {
  const label = t.message.generationError.kinds[error.kind];
  const action = t.message.generationError.actions[error.kind];
  const status = error.status
    ? `\n\n${t.message.generationError.status.replace("{status}", String(error.status))}`
    : "";
  const retryHint = error.retryable
    ? `\n\n${t.message.generationError.retryable}`
    : "";

  return [
    `⚠️ **${label}**`,
    action,
    `${t.message.generationError.detail}\n\n\`${error.message}\`${status}${retryHint}`,
  ].join("\n\n");
}
