import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServerEntry } from "./validation";

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  streamable: vi.fn(),
  sse: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", () => {
  class Client {
    connect = sdk.connect;
    close = vi.fn();
  }
  class StreamableHTTPClientTransport {
    constructor(...args: unknown[]) {
      sdk.streamable(...args);
    }
  }
  class SSEClientTransport {
    constructor(...args: unknown[]) {
      sdk.sse(...args);
    }
  }
  class ClientCredentialsProvider {
    clientMetadata = { redirect_uris: [] };
    constructor() {}
    clientInformation() {
      return { client_id: "test" };
    }
    tokens() {
      return undefined;
    }
    saveTokens() {}
    redirectToAuthorization() {}
    saveCodeVerifier() {}
    codeVerifier() {
      return "";
    }
    prepareTokenRequest() {
      return new URLSearchParams({ grant_type: "client_credentials" });
    }
  }
  return {
    Client,
    StreamableHTTPClientTransport,
    SSEClientTransport,
    ClientCredentialsProvider,
    UnauthorizedError: { isInstance: () => false },
  };
});

import { RemoteMcpClient } from "./remote-client";

describe("remote MCP transport selection", () => {
  beforeEach(() => {
    sdk.connect.mockReset();
    sdk.streamable.mockClear();
    sdk.sse.mockClear();
    sdk.connect.mockRejectedValue(new Error("HTTP 403"));
  });

  it("never falls back from Streamable HTTP to legacy SSE after an auth or connection error", async () => {
    const entry = createMcpServerEntry(
      {
        name: "Remote",
        transport: "streamable-http",
        url: "https://mcp.example.com/rpc",
      },
      { id: "remote" },
    );
    await expect(new RemoteMcpClient(entry).connect()).rejects.toThrow(
      "HTTP 403",
    );
    expect(sdk.streamable).toHaveBeenCalledOnce();
    expect(sdk.sse).not.toHaveBeenCalled();
  });

  it("constructs legacy SSE only when the configuration explicitly selects it", async () => {
    const entry = createMcpServerEntry(
      {
        name: "Legacy",
        transport: "sse",
        url: "https://mcp.example.com/sse",
      },
      { id: "legacy" },
    );
    await expect(new RemoteMcpClient(entry).connect()).rejects.toThrow(
      "HTTP 403",
    );
    expect(sdk.sse).toHaveBeenCalledOnce();
    expect(sdk.streamable).not.toHaveBeenCalled();
  });
});
