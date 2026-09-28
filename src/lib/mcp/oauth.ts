import {
  ClientCredentialsProvider,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { APP_VERSION } from "../app-version";
import type {
  McpAuthorizationCodeOAuthConfig,
  McpClientCredentialsOAuthConfig,
  McpOAuthConfig,
  McpOAuthTokenSet,
} from "./types";

export interface McpOAuthProviderOptions {
  serverUrl: string;
  config: McpOAuthConfig;
  persist: (config: McpOAuthConfig) => void | Promise<void>;
  redirectToAuthorization?: (url: URL) => void | Promise<void>;
  confirmCrossOriginIssuer?: (
    issuer: URL,
    server: URL,
  ) => boolean | Promise<boolean>;
}

export const MCP_OAUTH_PENDING_TTL_MS = 10 * 60 * 1_000;

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function toStoredTokens(
  tokens: McpOAuthTokenSet | undefined,
  issuer?: string,
): StoredOAuthTokens | undefined {
  if (!tokens?.accessToken) return undefined;
  const remainingSeconds = tokens.expiresAt
    ? Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1_000))
    : undefined;
  return {
    access_token: tokens.accessToken,
    token_type: tokens.tokenType || "Bearer",
    refresh_token: tokens.refreshToken,
    scope: tokens.scope,
    expires_in: remainingSeconds,
    issuer,
  };
}

function fromStoredTokens(tokens: StoredOAuthTokens): McpOAuthTokenSet {
  return {
    accessToken: tokens.access_token,
    tokenType: tokens.token_type,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope,
    expiresAt:
      typeof tokens.expires_in === "number"
        ? Date.now() + tokens.expires_in * 1_000
        : undefined,
  };
}

function defaultWebRedirectUrl(): URL {
  if (typeof window === "undefined") {
    throw new Error("OAuth redirect URL is unavailable outside a browser.");
  }
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL("mcp/oauth/callback/", base);
}

async function defaultRedirect(url: URL): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("OAuth authorization requires an interactive browser.");
  }
  const popup = window.open(
    url.toString(),
    "open-builder-mcp-oauth",
    "popup,width=620,height=760",
  );
  if (!popup) window.location.assign(url.toString());
}

function isSecureOAuthUrl(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]"))
  );
}

class PersistentAuthorizationCodeProvider implements OAuthClientProvider {
  private config: McpAuthorizationCodeOAuthConfig;
  private pendingState?: string;
  private pendingVerifier?: string;

  constructor(private readonly options: McpOAuthProviderOptions) {
    this.config = options.config as McpAuthorizationCodeOAuthConfig;
  }

  get redirectUrl(): URL {
    return this.config.redirectUri
      ? new URL(this.config.redirectUri)
      : defaultWebRedirectUrl();
  }

  get clientMetadataUrl(): string | undefined {
    return this.config.clientRegistration === "cimd"
      ? this.config.clientMetadataUrl
      : undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Open Builder",
      client_uri: "https://github.com/xiangfa/open-builder",
      redirect_uris: [this.redirectUrl.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientSecret
        ? "client_secret_basic"
        : "none",
      scope: this.config.scopes.join(" ") || undefined,
      software_version: APP_VERSION,
    };
  }

  async state(): Promise<string> {
    const state = this.config.pendingAuthorization?.state || randomState();
    this.pendingState = state;
    return state;
  }

  clientInformation(
    ctx?: OAuthClientInformationContext,
  ): StoredOAuthClientInformation | undefined {
    const registered = this.config.registeredClient;
    const clientId = registered?.clientId || this.config.clientId;
    if (!clientId) return undefined;
    const issuer = registered?.issuer || this.config.issuer || ctx?.issuer;
    return {
      client_id: clientId,
      client_secret: registered?.clientSecret || this.config.clientSecret,
      client_id_issued_at: registered?.clientIdIssuedAt,
      client_secret_expires_at: registered?.clientSecretExpiresAt,
      issuer,
    };
  }

  async saveClientInformation(
    information: StoredOAuthClientInformation,
  ): Promise<void> {
    this.config = {
      ...this.config,
      registeredClient: {
        clientId: information.client_id,
        clientSecret: information.client_secret,
        clientIdIssuedAt: information.client_id_issued_at,
        clientSecretExpiresAt: information.client_secret_expires_at,
        issuer: information.issuer,
      },
    };
    await this.options.persist(this.config);
  }

  tokens(ctx?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    return toStoredTokens(
      this.config.tokens,
      this.config.issuer || ctx?.issuer,
    );
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    this.config = {
      ...this.config,
      issuer: tokens.issuer || this.config.issuer,
      tokens: fromStoredTokens(tokens),
      pendingAuthorization: undefined,
    };
    await this.options.persist(this.config);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    const server = new URL(this.options.serverUrl);
    const issuer = this.config.issuer ? new URL(this.config.issuer) : url;
    if (!isSecureOAuthUrl(url)) {
      throw new Error(
        "OAuth authorization endpoint must use HTTPS or a loopback HTTP address.",
      );
    }
    if (issuer.origin !== server.origin) {
      const confirmed = await (this.options.confirmCrossOriginIssuer?.(
        issuer,
        server,
      ) ?? false);
      if (!confirmed) {
        throw new Error(
          "OAuth issuer uses a different origin and was not approved.",
        );
      }
    }
    if (url.origin !== issuer.origin) {
      const confirmed = await (this.options.confirmCrossOriginIssuer?.(
        url,
        issuer,
      ) ?? false);
      if (!confirmed) {
        throw new Error(
          "OAuth authorization endpoint uses an unapproved origin.",
        );
      }
    }
    await (this.options.redirectToAuthorization ?? defaultRedirect)(url);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.pendingVerifier = codeVerifier;
    this.config = {
      ...this.config,
      pendingAuthorization: {
        state:
          this.pendingState ||
          this.config.pendingAuthorization?.state ||
          randomState(),
        codeVerifier,
        createdAt: Date.now(),
      },
    };
    await this.options.persist(this.config);
  }

  codeVerifier(): string {
    const verifier =
      this.pendingVerifier || this.config.pendingAuthorization?.codeVerifier;
    if (!verifier)
      throw new Error("OAuth PKCE verifier is missing or expired.");
    return verifier;
  }

  async validateResourceURL(
    serverUrl: string | URL,
    resource?: string,
  ): Promise<URL | undefined> {
    const server = new URL(serverUrl);
    const selected = resource
      ? new URL(resource)
      : this.config.resource
        ? new URL(this.config.resource)
        : server;
    if (selected.origin !== server.origin) {
      throw new Error("OAuth resource must match the MCP server origin.");
    }
    return selected;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    this.config = {
      ...this.config,
      ...(scope === "all" || scope === "client"
        ? { registeredClient: undefined }
        : {}),
      ...(scope === "all" || scope === "tokens" ? { tokens: undefined } : {}),
      ...(scope === "all" || scope === "verifier"
        ? { pendingAuthorization: undefined }
        : {}),
      ...(scope === "all" || scope === "discovery"
        ? { discoveryState: undefined }
        : {}),
    };
    await this.options.persist(this.config);
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.config = {
      ...this.config,
      discoveryState:
        state as unknown as McpAuthorizationCodeOAuthConfig["discoveryState"],
    };
    await this.options.persist(this.config);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.config.discoveryState as unknown as
      OAuthDiscoveryState | undefined;
  }
}

class PersistentClientCredentialsProvider implements OAuthClientProvider {
  private readonly inner: ClientCredentialsProvider;
  private config: McpClientCredentialsOAuthConfig;

  constructor(private readonly options: McpOAuthProviderOptions) {
    this.config = options.config as McpClientCredentialsOAuthConfig;
    this.inner = new ClientCredentialsProvider({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      clientName: "Open Builder",
      scope: this.config.scopes.join(" ") || undefined,
      expectedIssuer: this.config.issuer,
    });
    const stored = toStoredTokens(this.config.tokens, this.config.issuer);
    if (stored) this.inner.saveTokens(stored);
  }

  get redirectUrl(): undefined {
    return undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.inner.clientMetadata;
  }

  clientInformation(): StoredOAuthClientInformation {
    return this.inner.clientInformation();
  }

  tokens(): StoredOAuthTokens | undefined {
    return this.inner.tokens();
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    this.inner.saveTokens(tokens);
    this.config = {
      ...this.config,
      issuer: tokens.issuer || this.config.issuer,
      tokens: fromStoredTokens(tokens),
    };
    await this.options.persist(this.config);
  }

  redirectToAuthorization(): void {
    this.inner.redirectToAuthorization();
  }

  saveCodeVerifier(): void {
    this.inner.saveCodeVerifier();
  }

  codeVerifier(): string {
    return this.inner.codeVerifier();
  }

  prepareTokenRequest(scope?: string): URLSearchParams {
    const params = this.inner.prepareTokenRequest(scope);
    if (this.config.resource) params.set("resource", this.config.resource);
    return params;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    if (!this.config.tokenEndpoint) return undefined;
    const tokenEndpoint = new URL(this.config.tokenEndpoint);
    const issuer = this.config.issuer || tokenEndpoint.origin;
    return {
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        authorization_endpoint: issuer,
        token_endpoint: tokenEndpoint.toString(),
        response_types_supported: [],
        grant_types_supported: ["client_credentials"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      },
    };
  }
}

export function createMcpOAuthProvider(
  options: McpOAuthProviderOptions,
): OAuthClientProvider {
  return options.config.type === "client-credentials"
    ? new PersistentClientCredentialsProvider(options)
    : new PersistentAuthorizationCodeProvider(options);
}

export function validateOAuthCallbackState(
  config: McpAuthorizationCodeOAuthConfig,
  params: URLSearchParams,
  now = Date.now(),
): void {
  const pending = config.pendingAuthorization;
  const expected = pending?.state;
  const actual = params.get("state");
  if (!expected || !actual || expected !== actual) {
    throw new Error("OAuth callback state validation failed.");
  }
  if (
    !Number.isFinite(pending.createdAt) ||
    pending.createdAt > now + 60_000 ||
    now - pending.createdAt > MCP_OAUTH_PENDING_TTL_MS
  ) {
    throw new Error("OAuth callback state has expired.");
  }
}
