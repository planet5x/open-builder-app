import { describe, expect, it } from "vitest";
import {
  MCP_REDACTED_VALUE,
  redactMcpError,
  redactMcpErrorForServer,
  redactMcpHeaders,
  redactKnownMcpServerSecrets,
  redactMcpValue,
} from "./redaction";
import { createMcpServerEntry } from "./validation";

describe("MCP credential redaction", () => {
  it("redacts headers, OAuth fields, PKCE verifier, URL credentials, and query tokens", () => {
    expect(
      redactMcpHeaders({
        Authorization: "Bearer secret",
        Accept: "application/json",
      }),
    ).toEqual({
      Authorization: MCP_REDACTED_VALUE,
      Accept: "application/json",
    });

    const value = redactMcpValue({
      clientSecret: "secret",
      sshPrivateKey: "private-key",
      pendingAuthorization: { state: "public-state", codeVerifier: "verifier" },
      url: "https://user:pass@example.com/mcp?access_token=token",
    });
    expect(value).toMatchObject({
      clientSecret: MCP_REDACTED_VALUE,
      sshPrivateKey: MCP_REDACTED_VALUE,
      pendingAuthorization: MCP_REDACTED_VALUE,
    });
    expect(JSON.stringify(value)).not.toContain("pass");
    expect(JSON.stringify(value)).not.toContain('token"');
  });

  it("redacts and bounds error strings", () => {
    const result = redactMcpError(
      new Error(`Authorization: Bearer top-secret ${"x".repeat(2_000)}`),
      100,
    );
    expect(result).not.toContain("top-secret");
    expect(result).toContain("[REDACTED]");
    expect(result).toContain("[truncated]");
  });

  it("removes exact configured secrets from server-controlled tool output", () => {
    const entry = createMcpServerEntry(
      {
        name: "Secrets",
        transport: "streamable-http",
        url: "https://example.com/mcp",
        headers: {
          "X-Custom": "header-secret",
          "X-Short-Custom": "abc",
        },
        oauth: {
          type: "authorization-code",
          clientRegistration: "manual",
          clientId: "client",
          clientSecret: "client-secret",
          scopes: [],
          pendingAuthorization: {
            state: "state-value",
            codeVerifier: "pkce-secret",
            createdAt: Date.now(),
          },
        },
      },
      { id: "secrets" },
    );
    const redacted = redactKnownMcpServerSecrets(
      {
        text: "header-secret abc client-secret",
        structuredContent: { verifier: "pkce-secret" },
      },
      entry,
    );
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("header-secret");
    expect(serialized).not.toContain('"abc"');
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("pkce-secret");
  });

  it("removes every configured header, env, and OAuth secret from errors", () => {
    const entry = createMcpServerEntry(
      {
        name: "Error secrets",
        transport: "streamable-http",
        url: "https://example.com/mcp",
        headers: { "X-Custom": "abc" },
        oauth: {
          type: "authorization-code",
          clientRegistration: "manual",
          clientId: "client",
          clientSecret: "oauth-client-sentinel",
          scopes: [],
          tokens: {
            accessToken: "oauth-access-sentinel",
            refreshToken: "oauth-refresh-sentinel",
          },
          pendingAuthorization: {
            state: "oauth-state-sentinel",
            codeVerifier: "oauth-verifier-sentinel",
            createdAt: Date.now(),
          },
          registeredClient: {
            clientId: "registered-client",
            clientSecret: "oauth-registered-sentinel",
          },
        },
      },
      { id: "error-secrets" },
    );
    entry.env = { MCP_SECRET: "env-secret-sentinel" };
    const raw = [
      "abc",
      "env-secret-sentinel",
      "oauth-client-sentinel",
      "oauth-access-sentinel",
      "oauth-refresh-sentinel",
      "oauth-state-sentinel",
      "oauth-verifier-sentinel",
      "oauth-registered-sentinel",
    ].join(" ");

    const redacted = redactMcpErrorForServer(new Error(raw), entry);

    for (const secret of raw.split(" ")) expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED]");
  });
});
