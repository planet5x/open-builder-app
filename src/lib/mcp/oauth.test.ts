import { describe, expect, it, vi } from "vitest";
import {
  createMcpOAuthProvider,
  MCP_OAUTH_PENDING_TTL_MS,
  validateOAuthCallbackState,
} from "./oauth";
import type { McpAuthorizationCodeOAuthConfig, McpOAuthConfig } from "./types";

describe("MCP OAuth provider", () => {
  it("persists PKCE state/verifier, validates callback state, and clears pending data after tokens", async () => {
    let persisted: McpOAuthConfig | undefined;
    const config: McpAuthorizationCodeOAuthConfig = {
      type: "authorization-code",
      clientRegistration: "manual",
      clientId: "open-builder",
      scopes: ["tools.read"],
      redirectUri: "https://builder.example.com/mcp/oauth/callback",
    };
    const provider = createMcpOAuthProvider({
      serverUrl: "https://mcp.example.com/rpc",
      config,
      persist: (next) => {
        persisted = next;
      },
    });

    const state = await provider.state!();
    await provider.saveCodeVerifier("pkce-verifier");
    expect(persisted).toMatchObject({
      pendingAuthorization: {
        state,
        codeVerifier: "pkce-verifier",
      },
    });
    validateOAuthCallbackState(
      persisted as McpAuthorizationCodeOAuthConfig,
      new URLSearchParams({ state, code: "authorization-code" }),
    );
    expect(() =>
      validateOAuthCallbackState(
        persisted as McpAuthorizationCodeOAuthConfig,
        new URLSearchParams({ state: "wrong", code: "authorization-code" }),
      ),
    ).toThrow(/state validation failed/i);
    expect(() =>
      validateOAuthCallbackState(
        persisted as McpAuthorizationCodeOAuthConfig,
        new URLSearchParams({ state, code: "authorization-code" }),
        (persisted as McpAuthorizationCodeOAuthConfig).pendingAuthorization!
          .createdAt +
          MCP_OAUTH_PENDING_TTL_MS +
          1,
      ),
    ).toThrow(/expired/i);

    await provider.saveTokens({
      access_token: "access",
      token_type: "Bearer",
      refresh_token: "refresh",
      expires_in: 60,
      issuer: "https://auth.example.com",
    });
    expect(persisted).toMatchObject({
      issuer: "https://auth.example.com",
      tokens: {
        accessToken: "access",
        refreshToken: "refresh",
      },
      pendingAuthorization: undefined,
    });
  });

  it("enforces resource origin binding and explicit cross-origin issuer approval", async () => {
    const redirect = vi.fn();
    const provider = createMcpOAuthProvider({
      serverUrl: "https://mcp.example.com/rpc",
      config: {
        type: "authorization-code",
        issuer: "https://login.example.net",
        clientRegistration: "manual",
        clientId: "open-builder",
        scopes: [],
        redirectUri: "https://builder.example.com/mcp/oauth/callback",
      },
      persist: () => {},
      redirectToAuthorization: redirect,
      confirmCrossOriginIssuer: () => false,
    });

    await expect(
      provider.validateResourceURL!(
        "https://mcp.example.com/rpc",
        "https://evil.example.net/resource",
      ),
    ).rejects.toThrow(/must match/i);
    await expect(
      provider.redirectToAuthorization!(
        new URL("https://login.example.net/authorize"),
      ),
    ).rejects.toThrow(/not approved/i);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("uses the SDK client-credentials grant and persists refreshed tokens", async () => {
    let persisted: McpOAuthConfig | undefined;
    const provider = createMcpOAuthProvider({
      serverUrl: "https://mcp.example.com/rpc",
      config: {
        type: "client-credentials",
        issuer: "https://auth.example.com",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        clientId: "service",
        clientSecret: "secret",
        scopes: ["tools.read"],
        resource: "https://mcp.example.com/rpc",
      },
      persist: (next) => {
        persisted = next;
      },
    });

    const params = await provider.prepareTokenRequest!("tools.read");
    expect(params?.get("grant_type")).toBe("client_credentials");
    expect(params?.get("resource")).toBe("https://mcp.example.com/rpc");
    expect(await provider.discoveryState!()).toMatchObject({
      authorizationServerUrl: "https://auth.example.com",
      authorizationServerMetadata: {
        token_endpoint: "https://auth.example.com/oauth/token",
      },
    });
    await provider.saveTokens({
      access_token: "rotated",
      token_type: "Bearer",
      expires_in: 120,
      issuer: "https://auth.example.com",
    });
    expect(persisted).toMatchObject({
      tokens: { accessToken: "rotated" },
    });
  });
});
