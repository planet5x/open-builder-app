import { MCP_LIMITS } from "./limits";
import { TOOL_POLICY_VERSION } from "../ai/tool-policy-version";
import type {
  JsonObject,
  McpPlatform,
  McpServerConfig,
  McpServerDraft,
  McpServerEntry,
  McpToolApproval,
  McpToolDefinition,
} from "./types";

export interface McpValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface McpValidationResult {
  valid: boolean;
  errors: McpValidationIssue[];
  warnings: McpValidationIssue[];
}

export interface McpValidationOptions {
  platform?: McpPlatform;
  pageProtocol?: string;
}

export class McpValidationError extends Error {
  constructor(public readonly issues: McpValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "McpValidationError";
  }
}

const SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PLACEHOLDER_PATTERN = /\$\{[^}]+\}|\{\{[^}]+\}\}/;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function issue(
  path: string,
  code: string,
  message: string,
): McpValidationIssue {
  return { path, code, message };
}

function validateUrl(
  raw: string | undefined,
  path: string,
  errors: McpValidationIssue[],
): URL | undefined {
  if (!raw?.trim()) {
    errors.push(issue(path, "required", "URL is required."));
    return undefined;
  }
  if (raw.length > MCP_LIMITS.maxUrlChars) {
    errors.push(
      issue(
        path,
        "too_long",
        `URL must be at most ${MCP_LIMITS.maxUrlChars} characters.`,
      ),
    );
    return undefined;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      errors.push(
        issue(path, "invalid_protocol", "URL must use HTTP or HTTPS."),
      );
      return undefined;
    }
    if (parsed.username || parsed.password) {
      errors.push(
        issue(
          path,
          "userinfo",
          "URL credentials are not allowed; use headers or OAuth.",
        ),
      );
    }
    return parsed;
  } catch {
    errors.push(issue(path, "invalid_url", "URL is invalid."));
    return undefined;
  }
}

export function isLoopbackMcpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function requireHttpsOrLoopback(
  parsed: URL | undefined,
  path: string,
  errors: McpValidationIssue[],
  platform?: McpPlatform,
): void {
  if (
    parsed?.protocol === "http:" &&
    (!isLoopbackMcpHost(parsed.hostname) ||
      (platform !== undefined && platform !== "desktop"))
  ) {
    errors.push(
      issue(
        path,
        "insecure_transport",
        platform && platform !== "desktop"
          ? "Web and mobile MCP endpoints must use HTTPS."
          : "Remote MCP must use HTTPS; HTTP is allowed only for desktop loopback hosts.",
      ),
    );
  }
}

function validateSecureOptionalUrl(
  raw: string | undefined,
  path: string,
  errors: McpValidationIssue[],
  platform?: McpPlatform,
): void {
  if (raw === undefined) return;
  requireHttpsOrLoopback(
    validateUrl(raw, path, errors),
    path,
    errors,
    platform,
  );
}

function requireHttpsForCredentials(
  parsed: URL | undefined,
  path: string,
  errors: McpValidationIssue[],
): void {
  if (parsed?.protocol === "http:") {
    errors.push(
      issue(
        path,
        "credential_transport",
        "Credential-bearing MCP requests must use HTTPS, including loopback targets.",
      ),
    );
  }
}

function validatePlaceholders(
  values: Array<[string, string | undefined]>,
  warnings: McpValidationIssue[],
): void {
  for (const [path, value] of values) {
    if (value && PLACEHOLDER_PATTERN.test(value)) {
      warnings.push(
        issue(
          path,
          "placeholder",
          "Placeholder syntax is stored literally and is not expanded by Open Builder.",
        ),
      );
    }
  }
}

export function validateMcpServerConfig(
  config: McpServerConfig | McpServerDraft,
  options: McpValidationOptions = {},
): McpValidationResult {
  const errors: McpValidationIssue[] = [];
  const warnings: McpValidationIssue[] = [];
  const id = config.id;

  if (id !== undefined) {
    if (
      !SERVER_ID_PATTERN.test(id) ||
      id.length > MCP_LIMITS.maxServerIdChars
    ) {
      errors.push(
        issue(
          "id",
          "invalid_id",
          `Server id must match ${SERVER_ID_PATTERN} and be at most ${MCP_LIMITS.maxServerIdChars} characters.`,
        ),
      );
    }
  }
  if (!config.name.trim()) {
    errors.push(issue("name", "required", "Server name is required."));
  } else if (config.name.length > MCP_LIMITS.maxServerNameChars) {
    errors.push(
      issue(
        "name",
        "too_long",
        `Server name must be at most ${MCP_LIMITS.maxServerNameChars} characters.`,
      ),
    );
  }

  if (
    !(["streamable-http", "sse", "stdio"] as string[]).includes(
      config.transport,
    )
  ) {
    errors.push(
      issue("transport", "unsupported", "Unsupported MCP transport."),
    );
  }

  const isRemote =
    config.transport === "streamable-http" || config.transport === "sse";
  if (isRemote) {
    const parsed = validateUrl(config.url, "url", errors);
    requireHttpsOrLoopback(parsed, "url", errors, options.platform);
    if (
      Object.keys(config.headers ?? {}).length > 0 ||
      config.oauth !== undefined
    ) {
      requireHttpsForCredentials(parsed, "url", errors);
    }
    if (
      parsed?.protocol === "http:" &&
      options.pageProtocol === "https:" &&
      options.platform !== "desktop"
    ) {
      errors.push(
        issue(
          "url",
          "mixed_content",
          "An HTTPS web app cannot connect directly to an insecure HTTP MCP server.",
        ),
      );
    }
    if (config.command || config.args?.length || config.env || config.cwd) {
      errors.push(
        issue(
          "transport",
          "mixed_transport_fields",
          "Remote transports cannot include stdio command, args, env, or cwd fields.",
        ),
      );
    }
    const headers = Object.entries(config.headers ?? {});
    if (headers.length > MCP_LIMITS.maxHeaders) {
      errors.push(
        issue(
          "headers",
          "too_many",
          `At most ${MCP_LIMITS.maxHeaders} headers are allowed.`,
        ),
      );
    }
    for (const [name, value] of headers) {
      if (
        !HEADER_NAME_PATTERN.test(name) ||
        name.length > MCP_LIMITS.maxHeaderNameChars
      ) {
        errors.push(
          issue(`headers.${name}`, "invalid_header", "Invalid header name."),
        );
      }
      if (/\r|\n/.test(value)) {
        errors.push(
          issue(
            `headers.${name}`,
            "invalid_header",
            "Header values cannot contain newlines.",
          ),
        );
      } else if (utf8Bytes(value) > MCP_LIMITS.maxHeaderValueBytes) {
        errors.push(
          issue(
            `headers.${name}`,
            "too_large",
            `Header value exceeds ${MCP_LIMITS.maxHeaderValueBytes} bytes.`,
          ),
        );
      }
    }
    validatePlaceholders(
      [
        ["url", config.url],
        ...headers.map(
          ([name, value]) => [`headers.${name}`, value] as [string, string],
        ),
      ],
      warnings,
    );
  } else if (config.transport === "stdio") {
    if (options.platform && options.platform !== "desktop") {
      errors.push(
        issue(
          "transport",
          "unsupported_platform",
          "Local stdio MCP servers are available only in the desktop app.",
        ),
      );
    }
    if (!config.command?.trim()) {
      errors.push(
        issue("command", "required", "Command is required for stdio."),
      );
    } else if (
      config.command.length > MCP_LIMITS.maxCommandChars ||
      /[\0\r\n]/.test(config.command)
    ) {
      errors.push(
        issue("command", "invalid_command", "Command is invalid or too long."),
      );
    }
    if (config.url || config.headers || config.oauth) {
      errors.push(
        issue(
          "transport",
          "mixed_transport_fields",
          "Stdio transport cannot include URL, headers, or OAuth fields.",
        ),
      );
    }
    if ((config.args?.length ?? 0) > MCP_LIMITS.maxArgs) {
      errors.push(
        issue(
          "args",
          "too_many",
          `At most ${MCP_LIMITS.maxArgs} args are allowed.`,
        ),
      );
    }
    for (const [index, value] of (config.args ?? []).entries()) {
      if (/[\0\r\n]/.test(value) || utf8Bytes(value) > MCP_LIMITS.maxArgBytes) {
        errors.push(
          issue(
            `args.${index}`,
            "invalid_arg",
            "Argument is invalid or too large.",
          ),
        );
      }
    }
    const env = Object.entries(config.env ?? {});
    if (env.length > MCP_LIMITS.maxEnvEntries) {
      errors.push(
        issue(
          "env",
          "too_many",
          `At most ${MCP_LIMITS.maxEnvEntries} env entries are allowed.`,
        ),
      );
    }
    for (const [name, value] of env) {
      if (!ENV_NAME_PATTERN.test(name)) {
        errors.push(
          issue(
            `env.${name}`,
            "invalid_env_name",
            "Invalid environment variable name.",
          ),
        );
      }
      if (
        value.includes("\0") ||
        utf8Bytes(value) > MCP_LIMITS.maxEnvValueBytes
      ) {
        errors.push(
          issue(
            `env.${name}`,
            "invalid_env_value",
            "Environment value is invalid or too large.",
          ),
        );
      }
    }
    if (
      config.cwd &&
      (config.cwd.length > MCP_LIMITS.maxCwdChars ||
        /[\0\r\n]/.test(config.cwd))
    ) {
      errors.push(
        issue(
          "cwd",
          "invalid_cwd",
          "Working directory is invalid or too long.",
        ),
      );
    }
    validatePlaceholders(
      [
        ["command", config.command],
        ...(config.args ?? []).map(
          (value, index) => [`args.${index}`, value] as [string, string],
        ),
        ...env.map(
          ([name, value]) => [`env.${name}`, value] as [string, string],
        ),
        ["cwd", config.cwd],
      ],
      warnings,
    );
  }

  if (config.requestTimeoutMs !== undefined) {
    if (
      !Number.isInteger(config.requestTimeoutMs) ||
      config.requestTimeoutMs < MCP_LIMITS.minRequestTimeoutMs ||
      config.requestTimeoutMs > MCP_LIMITS.maxRequestTimeoutMs
    ) {
      errors.push(
        issue(
          "requestTimeoutMs",
          "out_of_range",
          `Timeout must be an integer from ${MCP_LIMITS.minRequestTimeoutMs} to ${MCP_LIMITS.maxRequestTimeoutMs} ms.`,
        ),
      );
    }
  }

  const oauth = config.oauth;
  if (oauth) {
    if (!isRemote) {
      errors.push(
        issue(
          "oauth",
          "unsupported",
          "OAuth is supported only for remote transports.",
        ),
      );
    }
    validateSecureOptionalUrl(
      oauth.issuer,
      "oauth.issuer",
      errors,
      options.platform,
    );
    if (oauth.type === "authorization-code") {
      if (oauth.clientRegistration === "cimd") {
        const metadataUrl = validateUrl(
          oauth.clientMetadataUrl,
          "oauth.clientMetadataUrl",
          errors,
        );
        const isLoopback = metadataUrl
          ? isLoopbackMcpHost(metadataUrl.hostname)
          : false;
        if (
          metadataUrl &&
          metadataUrl.protocol !== "https:" &&
          !(
            metadataUrl.protocol === "http:" &&
            isLoopback &&
            (options.platform === undefined || options.platform === "desktop")
          )
        ) {
          errors.push(
            issue(
              "oauth.clientMetadataUrl",
              "invalid_protocol",
              "CIMD metadata must use HTTPS; HTTP is allowed only for desktop loopback hosts.",
            ),
          );
        }
      } else if (oauth.clientMetadataUrl !== undefined) {
        errors.push(
          issue(
            "oauth.clientMetadataUrl",
            "unsupported",
            "Client metadata URL is used only with CIMD registration.",
          ),
        );
      }
      if (oauth.clientRegistration === "manual" && !oauth.clientId?.trim()) {
        errors.push(
          issue(
            "oauth.clientId",
            "required",
            "Manual OAuth registration requires a client id.",
          ),
        );
      }
      validateSecureOptionalUrl(
        oauth.redirectUri,
        "oauth.redirectUri",
        errors,
        options.platform,
      );
      validateSecureOptionalUrl(
        oauth.registeredClient?.issuer,
        "oauth.registeredClient.issuer",
        errors,
        options.platform,
      );
      if (
        oauth.pendingAuthorization &&
        (!oauth.pendingAuthorization.state ||
          !oauth.pendingAuthorization.codeVerifier ||
          utf8Bytes(oauth.pendingAuthorization.state) > 4_096 ||
          utf8Bytes(oauth.pendingAuthorization.codeVerifier) > 4_096 ||
          !Number.isFinite(oauth.pendingAuthorization.createdAt))
      ) {
        errors.push(
          issue(
            "oauth.pendingAuthorization",
            "invalid",
            "Pending OAuth authorization state is invalid.",
          ),
        );
      }
    } else {
      if (!oauth.clientId.trim()) {
        errors.push(
          issue("oauth.clientId", "required", "Client id is required."),
        );
      }
      if (!oauth.clientSecret) {
        errors.push(
          issue("oauth.clientSecret", "required", "Client secret is required."),
        );
      }
      if (!oauth.issuer && !oauth.tokenEndpoint) {
        errors.push(
          issue(
            "oauth.tokenEndpoint",
            "required",
            "Client Credentials requires an issuer or token endpoint.",
          ),
        );
      }
      if (oauth.tokenEndpoint !== undefined) {
        const tokenEndpoint = validateUrl(
          oauth.tokenEndpoint,
          "oauth.tokenEndpoint",
          errors,
        );
        requireHttpsOrLoopback(tokenEndpoint, "oauth.tokenEndpoint", errors);
        requireHttpsForCredentials(
          tokenEndpoint,
          "oauth.tokenEndpoint",
          errors,
        );
      }
    }
    if (oauth.resource !== undefined) {
      const resource = validateUrl(oauth.resource, "oauth.resource", errors);
      requireHttpsOrLoopback(resource, "oauth.resource", errors);
      requireHttpsForCredentials(resource, "oauth.resource", errors);
    }
    if (
      oauth.scopes.length > 64 ||
      oauth.scopes.some((scope) => !scope.trim())
    ) {
      errors.push(
        issue("oauth.scopes", "invalid_scopes", "OAuth scopes are invalid."),
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateMcpToolDefinition(
  tool: McpToolDefinition,
): McpValidationResult {
  const errors: McpValidationIssue[] = [];
  if (!tool.name.trim() || tool.name.length > MCP_LIMITS.maxToolNameChars) {
    errors.push(
      issue("name", "invalid_name", "Tool name is empty or too long."),
    );
  }
  if (
    tool.description &&
    utf8Bytes(tool.description) > MCP_LIMITS.maxToolDescriptionBytes
  ) {
    errors.push(
      issue("description", "too_large", "Tool description is too large."),
    );
  }
  for (const [path, schema] of [
    ["inputSchema", tool.inputSchema],
    ["outputSchema", tool.outputSchema],
  ] as Array<[string, JsonObject | undefined]>) {
    if (
      schema &&
      utf8Bytes(JSON.stringify(schema)) > MCP_LIMITS.maxToolSchemaBytes
    ) {
      errors.push(issue(path, "too_large", `Tool ${path} is too large.`));
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateMcpServerEntry(
  entry: McpServerEntry,
  options: McpValidationOptions = {},
): McpValidationResult {
  const result = validateMcpServerConfig(entry, options);
  const errors = [...result.errors];
  if (
    entry.instructions &&
    utf8Bytes(entry.instructions) > MCP_LIMITS.maxInstructionsBytes
  ) {
    errors.push(
      issue("instructions", "too_large", "Server instructions are too large."),
    );
  }
  for (const [name, tool] of Object.entries(entry.tools)) {
    const toolResult = validateMcpToolDefinition(tool);
    errors.push(
      ...toolResult.errors.map((item) => ({
        ...item,
        path: `tools.${name}.${item.path}`,
      })),
    );
    if (name !== tool.name) {
      errors.push(
        issue(
          `tools.${name}`,
          "name_mismatch",
          "Tool key must match its name.",
        ),
      );
    }
    if (!tool.fingerprint) {
      errors.push(
        issue(
          `tools.${name}.fingerprint`,
          "required",
          "Approved fingerprint is required.",
        ),
      );
    }
    if (
      (tool.allowInPlanMode || tool.allowForSubagents) &&
      tool.annotations?.readOnlyHint !== true
    ) {
      errors.push(
        issue(
          `tools.${name}`,
          "readonly_required",
          "Plan Mode and subagent access require a server-declared read-only tool.",
        ),
      );
    }
  }
  return { valid: errors.length === 0, errors, warnings: result.warnings };
}

export interface CreateMcpServerEntryOptions extends McpValidationOptions {
  id?: string;
  now?: number;
}

function slugifyServerId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "mcp-server";
}

function randomIdSuffix(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every((byte) => byte === 0)) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createMcpServerEntry(
  draft: McpServerDraft,
  options: CreateMcpServerEntryOptions = {},
): McpServerEntry {
  const now = options.now ?? Date.now();
  const entry: McpServerEntry = {
    ...draft,
    id:
      options.id ??
      draft.id ??
      `${slugifyServerId(draft.name)}-${randomIdSuffix()}`,
    enabled: draft.enabled ?? false,
    requestTimeoutMs:
      draft.requestTimeoutMs ?? MCP_LIMITS.defaultRequestTimeoutMs,
    tools: {},
    createdAt: now,
    updatedAt: now,
  };
  const result = validateMcpServerEntry(entry, options);
  if (!result.valid) throw new McpValidationError(result.errors);
  return entry;
}

export function countEnabledMcpTools(
  servers: Record<string, McpServerEntry> | readonly McpServerEntry[],
): number {
  const entries: readonly McpServerEntry[] = Array.isArray(servers)
    ? (servers as readonly McpServerEntry[])
    : Object.values(servers as Record<string, McpServerEntry>);
  return entries.reduce(
    (count, server) =>
      count +
      (server.enabled
        ? Object.values(server.tools).filter((tool) => tool.enabled).length
        : 0),
    0,
  );
}

export function assertMcpToolLimit(
  servers: Record<string, McpServerEntry> | readonly McpServerEntry[],
): void {
  const count = countEnabledMcpTools(servers);
  if (count > MCP_LIMITS.maxEnabledTools) {
    throw new McpValidationError([
      issue(
        "tools",
        "too_many_enabled",
        `At most ${MCP_LIMITS.maxEnabledTools} MCP tools may be enabled; received ${count}.`,
      ),
    ]);
  }
}

export function sanitizeMcpToolPermissions<T extends McpToolApproval>(
  tool: T,
): T {
  if (tool.annotations?.readOnlyHint === true) return tool;
  return {
    ...tool,
    allowInPlanMode: false,
    allowForSubagents: false,
    elevatedPermissionsPolicyVersion: undefined,
  };
}

export function hasCurrentMcpElevatedPermission(
  tool: McpToolApproval,
  permission: "plan" | "subagent",
): boolean {
  const granted =
    permission === "plan" ? tool.allowInPlanMode : tool.allowForSubagents;
  return (
    granted &&
    tool.annotations?.readOnlyHint === true &&
    tool.elevatedPermissionsPolicyVersion === TOOL_POLICY_VERSION
  );
}
