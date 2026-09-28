import type { McpServerEntry } from "./types";

export const MCP_REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /(?:^|[_-])(authorization|cookie|password|passwd|secret|token|verifier|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)(?:$|[_-])/i;

const SENSITIVE_EXACT_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "apikey",
  "api-key",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "codeverifier",
  "state",
]);

export function isSensitiveMcpKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[_-]/g, "");
  return (
    SENSITIVE_EXACT_KEYS.has(key.toLowerCase()) ||
    SENSITIVE_EXACT_KEYS.has(compact) ||
    /authorization|cookie|password|passwd|secret|token|apikey|accesskey|privatekey|verifier/.test(
      compact,
    ) ||
    SENSITIVE_KEY_PATTERN.test(key)
  );
}

export function redactMcpText(value: string): string {
  return value
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
      `$1 ${MCP_REDACTED_VALUE}`,
    )
    .replace(
      /([?&](?:access_token|refresh_token|token|api_key|apikey|key|secret|password)=)[^&#\s]*/gi,
      `$1${MCP_REDACTED_VALUE}`,
    )
    .replace(
      /((?:authorization|x-api-key|api-key|access_token|refresh_token|client_secret|password)\s*[=:]\s*["']?)[^"'\s,;}]+/gi,
      `$1${MCP_REDACTED_VALUE}`,
    )
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, `$1${MCP_REDACTED_VALUE}@`);
}

export function redactMcpValue(value: unknown, key = ""): unknown {
  if (isSensitiveMcpKey(key) && value !== undefined) {
    return MCP_REDACTED_VALUE;
  }
  if (typeof value === "string") return redactMcpText(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactMcpValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactMcpValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function redactMcpHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSensitiveMcpKey(name) ? MCP_REDACTED_VALUE : redactMcpText(value),
    ]),
  );
}

export type RedactedMcpServerEntry = Omit<McpServerEntry, "oauth"> & {
  /** Redacted display/log data only. It must never be reused for a connection. */
  oauth?: unknown;
};

export function redactMcpServerEntry(
  entry: McpServerEntry,
): RedactedMcpServerEntry {
  return redactMcpValue(entry) as RedactedMcpServerEntry;
}

export function redactMcpError(error: unknown, maxChars = 1_000): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = redactMcpText(raw);
  if (redacted.length <= maxChars) return redacted;
  return `${redacted.slice(0, maxChars)} [truncated]`;
}

function knownServerSecrets(
  entry: McpServerEntry,
  minimumLength: number,
): string[] {
  const oauth = entry.oauth;
  return [
    ...Object.values(entry.headers ?? {}),
    ...Object.values(entry.env ?? {}),
    oauth?.clientSecret,
    oauth?.tokens?.accessToken,
    oauth?.tokens?.refreshToken,
    oauth?.type === "authorization-code"
      ? oauth.pendingAuthorization?.codeVerifier
      : undefined,
    oauth?.type === "authorization-code"
      ? oauth.pendingAuthorization?.state
      : undefined,
    oauth?.type === "authorization-code"
      ? oauth.registeredClient?.clientSecret
      : undefined,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length >= minimumLength)
    .sort((left, right) => right.length - left.length);
}

function redactKnownMcpServerSecretsWithMinimum<T>(
  value: T,
  entry: McpServerEntry,
  minimumLength: number,
): T {
  const secrets = knownServerSecrets(entry, minimumLength);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      return secrets.reduce(
        (text, secret) => text.split(secret).join(MCP_REDACTED_VALUE),
        current,
      );
    }
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current).map(([key, child]) => [key, visit(child)]),
      );
    }
    return current;
  };
  return visit(value) as T;
}

/** Redacts exact configured credential values from server-controlled data
 * without treating every generic `token` field in valid tool output as secret. */
export function redactKnownMcpServerSecrets<T>(
  value: T,
  entry: McpServerEntry,
): T {
  return redactKnownMcpServerSecretsWithMinimum(value, entry, 1);
}

export function redactMcpErrorForServer(
  error: unknown,
  entry: McpServerEntry,
  maxChars = 1_000,
): string {
  // Exceptions are not legitimate server data: remove every non-empty
  // configured credential, including short custom header/env values.
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = redactKnownMcpServerSecretsWithMinimum(
    redactMcpText(raw),
    entry,
    1,
  );
  if (redacted.length <= maxChars) return redacted;
  return `${redacted.slice(0, maxChars)} [truncated]`;
}
