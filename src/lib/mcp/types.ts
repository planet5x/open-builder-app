export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type McpTransportType = "streamable-http" | "sse" | "stdio";

export type McpPlatform = "web" | "desktop" | "mobile";

export interface McpOAuthTokenSet {
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: number;
}

export interface McpAuthorizationCodeOAuthConfig {
  type: "authorization-code";
  /** Authorization-server issuer. Discovered from the protected resource when omitted. */
  issuer?: string;
  clientRegistration: "cimd" | "dcr" | "manual";
  /** HTTPS Client ID Metadata Document URL used by CIMD. */
  clientMetadataUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
  redirectUri?: string;
  resource?: string;
  tokens?: McpOAuthTokenSet;
  /** Persisted so a browser/desktop authorization redirect can survive reload. */
  pendingAuthorization?: {
    state: string;
    codeVerifier: string;
    createdAt: number;
  };
  /** Persisted CIMD/DCR result. Manual clients continue to use clientId/clientSecret above. */
  registeredClient?: {
    clientId: string;
    clientSecret?: string;
    clientIdIssuedAt?: number;
    clientSecretExpiresAt?: number;
    issuer?: string;
  };
  /** Validated authorization-server discovery metadata used to resume the flow. */
  discoveryState?: JsonObject;
}

export interface McpClientCredentialsOAuthConfig {
  type: "client-credentials";
  issuer?: string;
  tokenEndpoint?: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  resource?: string;
  tokens?: McpOAuthTokenSet;
}

export type McpOAuthConfig =
  McpAuthorizationCodeOAuthConfig | McpClientCredentialsOAuthConfig;

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  /** Required for streamable-http and sse transports. */
  url?: string;
  /** Persisted locally exactly as entered. Consumers must redact before display/logging. */
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
  /** Required for stdio. Passed directly to Command without a shell. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  requestTimeoutMs?: number;
}

export type McpServerDraft = Omit<McpServerConfig, "id" | "enabled"> & {
  id?: string;
  enabled?: boolean;
};

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: McpToolAnnotations;
  _meta?: JsonObject;
}

export interface McpToolApproval extends McpToolDefinition {
  /** Fingerprint of the exact definition the user approved. */
  fingerprint: string;
  enabled: boolean;
  allowInPlanMode: boolean;
  allowForSubagents: boolean;
  /** Authorization-policy version under which elevated read-only access was approved. */
  elevatedPermissionsPolicyVersion?: string;
}

export interface McpServerEntry extends McpServerConfig {
  /** Approved instructions snapshot. Current runtime instructions are kept separately. */
  instructions?: string;
  instructionsFingerprint?: string;
  definitionFingerprint?: string;
  tools: Record<string, McpToolApproval>;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
}

export interface McpServerDiscovery {
  instructions?: string;
  tools: McpToolDefinition[];
}

export interface McpDriftReport {
  status: "clean" | "drifted" | "unapproved";
  added: string[];
  removed: string[];
  changed: string[];
  instructionsChanged: boolean;
  approvedFingerprint?: string;
  currentFingerprint: string;
}

export type McpConnectionStatus =
  "idle" | "connecting" | "needs_auth" | "ready" | "error" | "drifted";

export interface McpServerRuntimeState {
  status: McpConnectionStatus;
  /** Must already be redacted before being placed in UI state. */
  error?: string;
  instructions?: string;
  tools?: McpToolDefinition[];
  drift?: McpDriftReport;
  connectedAt?: number;
  updatedAt: number;
}

export type McpImportIssueSeverity = "warning" | "error";

export interface McpImportIssue {
  severity: McpImportIssueSeverity;
  code:
    | "invalid_json"
    | "invalid_root"
    | "invalid_server"
    | "unknown_field"
    | "unsupported_transport"
    | "unsupported_platform"
    | "placeholder"
    | "name_conflict";
  path: string;
  message: string;
}

export interface McpImportCandidate {
  name: string;
  config?: McpServerConfig;
  issues: McpImportIssue[];
  conflict: "none" | "existing";
  /** UI may change skip to replace after explicit user review. */
  action: "create" | "skip" | "replace";
  valid: boolean;
}

export interface McpImportPreview {
  candidates: McpImportCandidate[];
  issues: McpImportIssue[];
  validCount: number;
  errorCount: number;
}

export interface McpTextResultContent {
  type: "text";
  text: string;
  truncated?: boolean;
}

export interface McpBinaryResultContent {
  type: "image" | "audio";
  mimeType: string;
  /** Base64 data, omitted when invalid or over the configured attachment budget. */
  data?: string;
  size: number;
  omitted?: boolean;
  reason?: string;
}

export interface McpEmbeddedResourceResultContent {
  type: "resource";
  uri: string;
  name?: string;
  title?: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  size: number;
  omitted?: boolean;
  reason?: string;
}

export interface McpResourceLinkResultContent {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

export interface McpUnknownResultContent {
  type: "unsupported";
  originalType: string;
  reason: string;
}

export type McpToolResultContent =
  | McpTextResultContent
  | McpBinaryResultContent
  | McpEmbeddedResourceResultContent
  | McpResourceLinkResultContent
  | McpUnknownResultContent;

export interface McpToolResultSnapshot {
  serverId?: string;
  serverName?: string;
  toolName?: string;
  isError: boolean;
  content: McpToolResultContent[];
  structuredContent?: JsonValue;
  structuredContentOmitted?: boolean;
  /** Deterministic text fallback for providers that cannot accept rich tool output. */
  modelText: string;
  truncated: boolean;
}

/** Minimal SDK-compatible shape accepted by normalizeMcpToolResult. */
export interface McpCallToolResultLike {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: unknown;
}
