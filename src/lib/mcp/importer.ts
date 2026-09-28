import { MCP_LIMITS } from "./limits";
import type {
  McpImportCandidate,
  McpImportIssue,
  McpImportPreview,
  McpPlatform,
  McpServerConfig,
  McpServerEntry,
  McpTransportType,
} from "./types";
import {
  createMcpServerEntry,
  McpValidationError,
  validateMcpServerConfig,
} from "./validation";

export interface PreviewMcpServersImportOptions {
  platform: McpPlatform;
  existingServers?: Record<string, McpServerEntry> | readonly McpServerEntry[];
  pageProtocol?: string;
}

export interface ApplyMcpServersImportResult {
  servers: Record<string, McpServerEntry>;
  added: string[];
  replaced: string[];
  skipped: string[];
}

const ROOT_FIELDS = new Set(["mcpServers"]);
const SERVER_FIELDS = new Set([
  "url",
  "type",
  "transport",
  "headers",
  "command",
  "args",
  "env",
  "cwd",
  "disabled",
  "requestTimeoutMs",
]);
const PLACEHOLDER_PATTERN = /\$\{[^}]+\}|\{\{[^}]+\}\}/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function importIssue(
  severity: McpImportIssue["severity"],
  code: McpImportIssue["code"],
  path: string,
  message: string,
): McpImportIssue {
  return { severity, code, path, message };
}

function asStringRecord(
  value: unknown,
  path: string,
  issues: McpImportIssue[],
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(
      importIssue("error", "invalid_server", path, "Expected an object."),
    );
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== "string") {
      issues.push(
        importIssue(
          "error",
          "invalid_server",
          `${path}.${key}`,
          "Expected a string.",
        ),
      );
      continue;
    }
    result[key] = child;
  }
  return result;
}

function asStringArray(
  value: unknown,
  path: string,
  issues: McpImportIssue[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(
      importIssue("error", "invalid_server", path, "Expected an array."),
    );
    return undefined;
  }
  if (value.some((child) => typeof child !== "string")) {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        path,
        "Every array item must be a string.",
      ),
    );
    return undefined;
  }
  return value as string[];
}

function collectPlaceholders(
  value: unknown,
  path: string,
  issues: McpImportIssue[],
): void {
  if (typeof value === "string") {
    if (PLACEHOLDER_PATTERN.test(value)) {
      issues.push(
        importIssue(
          "warning",
          "placeholder",
          path,
          "Placeholder syntax will be stored literally; edit it before connecting.",
        ),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectPlaceholders(child, `${path}.${index}`, issues),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectPlaceholders(child, `${path}.${key}`, issues);
    }
  }
}

function existingList(
  existing: PreviewMcpServersImportOptions["existingServers"],
): McpServerEntry[] {
  if (!existing) return [];
  return Array.isArray(existing) ? [...existing] : Object.values(existing);
}

function parseTransport(
  raw: Record<string, unknown>,
  path: string,
  issues: McpImportIssue[],
): McpTransportType | undefined {
  const hasUrl = raw.url !== undefined;
  const hasCommand = raw.command !== undefined;
  if (hasUrl === hasCommand) {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        path,
        "Define exactly one of url or command.",
      ),
    );
    return undefined;
  }
  if (
    raw.type !== undefined &&
    raw.transport !== undefined &&
    raw.type !== raw.transport
  ) {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        `${path}.transport`,
        "type and transport disagree.",
      ),
    );
    return undefined;
  }
  const explicit = raw.transport ?? raw.type;
  if (explicit !== undefined && typeof explicit !== "string") {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        `${path}.transport`,
        "Transport must be a string.",
      ),
    );
    return undefined;
  }
  if (hasCommand) {
    if (explicit !== undefined && explicit !== "stdio") {
      issues.push(
        importIssue(
          "error",
          "unsupported_transport",
          `${path}.transport`,
          "A command entry must use stdio transport.",
        ),
      );
      return undefined;
    }
    return "stdio";
  }
  if (explicit === undefined || explicit === "streamable-http") {
    return "streamable-http";
  }
  if (explicit === "http") {
    issues.push(
      importIssue(
        "warning",
        "unknown_field",
        `${path}.transport`,
        'Transport "http" was normalized to "streamable-http".',
      ),
    );
    return "streamable-http";
  }
  if (explicit === "sse") return "sse";
  issues.push(
    importIssue(
      "error",
      "unsupported_transport",
      `${path}.transport`,
      `Unsupported transport "${String(explicit)}".`,
    ),
  );
  return undefined;
}

function parseCandidate(
  name: string,
  raw: unknown,
  options: PreviewMcpServersImportOptions,
  existing: McpServerEntry | undefined,
): McpImportCandidate {
  const path = `mcpServers.${name}`;
  const issues: McpImportIssue[] = [];
  if (!isRecord(raw)) {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        path,
        "Server config must be an object.",
      ),
    );
    return {
      name,
      issues,
      conflict: existing ? "existing" : "none",
      action: existing ? "skip" : "create",
      valid: false,
    };
  }
  for (const field of Object.keys(raw)) {
    if (!SERVER_FIELDS.has(field)) {
      issues.push(
        importIssue(
          "warning",
          "unknown_field",
          `${path}.${field}`,
          `Unknown field "${field}" was ignored.`,
        ),
      );
    }
  }

  const transport = parseTransport(raw, path, issues);
  const url = typeof raw.url === "string" ? raw.url : undefined;
  const command = typeof raw.command === "string" ? raw.command : undefined;
  if (raw.url !== undefined && typeof raw.url !== "string") {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        `${path}.url`,
        "URL must be a string.",
      ),
    );
  }
  if (raw.command !== undefined && typeof raw.command !== "string") {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        `${path}.command`,
        "Command must be a string.",
      ),
    );
  }
  if (raw.cwd !== undefined && typeof raw.cwd !== "string") {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        `${path}.cwd`,
        "cwd must be a string.",
      ),
    );
  }
  if (raw.disabled !== undefined && typeof raw.disabled !== "boolean") {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        `${path}.disabled`,
        "disabled must be boolean.",
      ),
    );
  }
  if (
    raw.requestTimeoutMs !== undefined &&
    typeof raw.requestTimeoutMs !== "number"
  ) {
    issues.push(
      importIssue(
        "error",
        "invalid_server",
        `${path}.requestTimeoutMs`,
        "requestTimeoutMs must be a number.",
      ),
    );
  }
  const headers = asStringRecord(raw.headers, `${path}.headers`, issues);
  const env = asStringRecord(raw.env, `${path}.env`, issues);
  const args = asStringArray(raw.args, `${path}.args`, issues);
  collectPlaceholders(raw, path, issues);

  let config: McpServerConfig | undefined;
  if (transport) {
    const draft = {
      id: existing?.id,
      name,
      enabled: false,
      transport,
      url,
      headers,
      command,
      args,
      env,
      cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
      requestTimeoutMs:
        typeof raw.requestTimeoutMs === "number"
          ? raw.requestTimeoutMs
          : undefined,
    };
    try {
      const entry = createMcpServerEntry(draft, {
        id: existing?.id,
        platform: options.platform,
        pageProtocol: options.pageProtocol,
      });
      config = {
        id: entry.id,
        name: entry.name,
        enabled: false,
        transport: entry.transport,
        url: entry.url,
        headers: entry.headers,
        command: entry.command,
        args: entry.args,
        env: entry.env,
        cwd: entry.cwd,
        requestTimeoutMs: entry.requestTimeoutMs,
      };
    } catch (error) {
      if (error instanceof McpValidationError) {
        for (const validationIssue of error.issues) {
          issues.push(
            importIssue(
              "error",
              validationIssue.code === "unsupported_platform"
                ? "unsupported_platform"
                : "invalid_server",
              `${path}.${validationIssue.path}`,
              validationIssue.message,
            ),
          );
        }
      } else {
        throw error;
      }
    }
  }

  if (existing) {
    issues.push(
      importIssue(
        "warning",
        "name_conflict",
        path,
        `A server named "${name}" already exists. Choose skip or replace.`,
      ),
    );
  }
  const valid =
    config !== undefined && !issues.some((item) => item.severity === "error");
  return {
    name,
    config,
    issues,
    conflict: existing ? "existing" : "none",
    action: existing ? "skip" : "create",
    valid,
  };
}

export function previewMcpServersImport(
  input: string | unknown,
  options: PreviewMcpServersImportOptions,
): McpImportPreview {
  const issues: McpImportIssue[] = [];
  let root: unknown = input;
  if (typeof input === "string") {
    if (
      new TextEncoder().encode(input).byteLength > MCP_LIMITS.maxImportBytes
    ) {
      issues.push(
        importIssue(
          "error",
          "invalid_json",
          "$",
          `Import exceeds ${MCP_LIMITS.maxImportBytes} bytes.`,
        ),
      );
      return { candidates: [], issues, validCount: 0, errorCount: 1 };
    }
    try {
      root = JSON.parse(input);
    } catch {
      issues.push(
        importIssue("error", "invalid_json", "$", "Import is not valid JSON."),
      );
      return { candidates: [], issues, validCount: 0, errorCount: 1 };
    }
  }
  if (!isRecord(root) || !isRecord(root.mcpServers)) {
    issues.push(
      importIssue(
        "error",
        "invalid_root",
        "mcpServers",
        "Expected an object with an mcpServers object.",
      ),
    );
    return { candidates: [], issues, validCount: 0, errorCount: 1 };
  }
  for (const field of Object.keys(root)) {
    if (!ROOT_FIELDS.has(field)) {
      issues.push(
        importIssue(
          "warning",
          "unknown_field",
          field,
          `Unknown root field "${field}" was ignored.`,
        ),
      );
    }
  }
  const existing = existingList(options.existingServers);
  const byName = new Map(
    existing.map((server) => [server.name.trim().toLowerCase(), server]),
  );
  const candidates = Object.entries(root.mcpServers).map(([name, raw]) =>
    parseCandidate(name, raw, options, byName.get(name.trim().toLowerCase())),
  );
  return {
    candidates,
    issues,
    validCount: candidates.filter((candidate) => candidate.valid).length,
    errorCount:
      issues.filter((item) => item.severity === "error").length +
      candidates.reduce(
        (count, candidate) =>
          count +
          candidate.issues.filter((item) => item.severity === "error").length,
        0,
      ),
  };
}

export function applyMcpServersImport(
  preview: McpImportPreview,
  existingServers: Record<string, McpServerEntry>,
  now = Date.now(),
): ApplyMcpServersImportResult {
  const servers = { ...existingServers };
  const added: string[] = [];
  const replaced: string[] = [];
  const skipped: string[] = [];
  for (const candidate of preview.candidates) {
    if (!candidate.valid || !candidate.config || candidate.action === "skip") {
      skipped.push(candidate.name);
      continue;
    }
    const existing = Object.values(servers).find(
      (server) =>
        server.name.trim().toLowerCase() ===
        candidate.name.trim().toLowerCase(),
    );
    if (candidate.action === "replace" && existing) {
      servers[existing.id] = {
        ...candidate.config,
        id: existing.id,
        enabled: false,
        tools: {},
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      replaced.push(existing.id);
      continue;
    }
    if (candidate.action === "create" && !existing) {
      const entry = createMcpServerEntry(
        { ...candidate.config, enabled: false },
        { id: candidate.config.id, now },
      );
      servers[entry.id] = entry;
      added.push(entry.id);
      continue;
    }
    skipped.push(candidate.name);
  }
  if (Object.keys(servers).length > MCP_LIMITS.maxServers) {
    throw new McpValidationError([
      {
        path: "mcpServers",
        code: "too_many",
        message: `At most ${MCP_LIMITS.maxServers} MCP servers are allowed.`,
      },
    ]);
  }
  return { servers, added, replaced, skipped };
}

/** Re-runs config validation after a user edits an import candidate. */
export function validateMcpImportCandidate(
  config: McpServerConfig,
  options: PreviewMcpServersImportOptions,
): boolean {
  return validateMcpServerConfig(config, options).valid;
}
