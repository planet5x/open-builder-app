import { describe, expect, it } from "vitest";
import type { McpServerEntry } from "./types";
import {
  assertMcpToolLimit,
  createMcpServerEntry,
  McpValidationError,
  sanitizeMcpToolPermissions,
  validateMcpServerConfig,
  validateMcpServerEntry,
  isLoopbackMcpHost,
} from "./validation";

describe("MCP config validation", () => {
  it("rejects stdio outside desktop and accepts direct command arguments", () => {
    const config = {
      name: "Local",
      transport: "stdio" as const,
      command: "tool;this-is-not-a-shell",
      args: ["--flag=value"],
    };
    expect(validateMcpServerConfig(config, { platform: "web" }).valid).toBe(
      false,
    );
    expect(validateMcpServerConfig(config, { platform: "desktop" }).valid).toBe(
      true,
    );
  });

  it("requires HTTPS CIMD metadata except for loopback hosts", () => {
    const base = {
      name: "OAuth",
      transport: "streamable-http" as const,
      url: "https://mcp.example.com",
      oauth: {
        type: "authorization-code" as const,
        clientRegistration: "cimd" as const,
        scopes: [],
        clientMetadataUrl: "http://example.com/client.json",
      },
    };
    expect(validateMcpServerConfig(base).valid).toBe(false);
    expect(
      validateMcpServerConfig({
        ...base,
        oauth: {
          ...base.oauth,
          clientMetadataUrl: "http://127.0.0.1/client.json",
        },
      }).valid,
    ).toBe(true);
  });

  it("requires HTTPS for every non-loopback remote MCP endpoint", () => {
    const remote = {
      name: "Remote",
      transport: "streamable-http" as const,
      url: "http://mcp.example.com/rpc",
      headers: { Authorization: "Bearer secret" },
    };
    const result = validateMcpServerConfig(remote, { platform: "desktop" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: "url", code: "insecure_transport" }),
    );

    expect(
      validateMcpServerConfig(
        {
          name: "Local without credentials",
          transport: "streamable-http",
          url: "http://127.0.0.2:8787/rpc",
        },
        { platform: "desktop" },
      ).valid,
    ).toBe(true);
    expect(
      validateMcpServerConfig(
        {
          name: "Web loopback",
          transport: "streamable-http",
          url: "http://127.0.0.2:8787/rpc",
        },
        { platform: "web" },
      ).valid,
    ).toBe(false);
    expect(
      validateMcpServerConfig(
        {
          name: "Mobile loopback",
          transport: "streamable-http",
          url: "http://localhost:8787/rpc",
        },
        { platform: "mobile" },
      ).valid,
    ).toBe(false);
    expect(isLoopbackMcpHost("[::1]")).toBe(true);
  });

  it("rejects credential-bearing MCP over loopback HTTP", () => {
    const withHeaders = validateMcpServerConfig({
      name: "Local header auth",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/rpc",
      headers: { Authorization: "Bearer secret" },
    });
    expect(withHeaders.errors).toContainEqual(
      expect.objectContaining({ path: "url", code: "credential_transport" }),
    );

    const withOAuth = validateMcpServerConfig({
      name: "Local OAuth",
      transport: "streamable-http",
      url: "http://localhost:8787/rpc",
      oauth: {
        type: "client-credentials",
        clientId: "client",
        clientSecret: "secret",
        tokenEndpoint: "http://localhost:8788/token",
        scopes: [],
      },
    });
    expect(withOAuth.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "url", code: "credential_transport" }),
        expect.objectContaining({
          path: "oauth.tokenEndpoint",
          code: "credential_transport",
        }),
      ]),
    );
  });

  it("rejects insecure OAuth token and issuer endpoints", () => {
    const result = validateMcpServerConfig({
      name: "OAuth",
      transport: "streamable-http",
      url: "https://mcp.example.com",
      oauth: {
        type: "client-credentials",
        clientId: "client",
        clientSecret: "secret",
        issuer: "http://issuer.example.com",
        tokenEndpoint: "http://tokens.example.com/token",
        scopes: [],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(["oauth.issuer", "oauth.tokenEndpoint"]),
    );
  });

  it("enforces read-only permission gates", () => {
    const tool = sanitizeMcpToolPermissions({
      name: "write",
      inputSchema: { type: "object" },
      fingerprint: "fingerprint",
      enabled: true,
      allowInPlanMode: true,
      allowForSubagents: true,
    });
    expect(tool).toMatchObject({
      allowInPlanMode: false,
      allowForSubagents: false,
    });

    const entry = createMcpServerEntry(
      {
        name: "Remote",
        transport: "streamable-http",
        url: "https://example.com/mcp",
      },
      { id: "remote" },
    ) as McpServerEntry;
    entry.tools.write = { ...tool, allowInPlanMode: true };
    expect(validateMcpServerEntry(entry).valid).toBe(false);
  });

  it("rejects more than 64 enabled tools instead of truncating", () => {
    const entry = createMcpServerEntry(
      {
        name: "Many tools",
        enabled: true,
        transport: "streamable-http",
        url: "https://example.com/mcp",
      },
      { id: "many" },
    );
    entry.tools = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => {
        const name = `tool_${index}`;
        return [
          name,
          {
            name,
            inputSchema: { type: "object" },
            fingerprint: `fingerprint-${index}`,
            enabled: true,
            allowInPlanMode: false,
            allowForSubagents: false,
          },
        ];
      }),
    );

    expect(() => assertMcpToolLimit({ many: entry })).toThrow(
      McpValidationError,
    );
  });
});
