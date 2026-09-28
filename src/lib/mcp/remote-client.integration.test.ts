import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createMcpServerEntry } from "./validation";
import { RemoteMcpClient } from "./remote-client";

describe("RemoteMcpClient with Streamable HTTP", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const send = (result: unknown) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
          );
        };
        if (message.method === "server/discover") {
          send({
            resultType: "complete",
            supportedVersions: ["2026-07-28"],
            capabilities: { tools: { listChanged: false } },
            instructions: "Local remote fixture",
            ttlMs: 0,
            cacheScope: "private",
            _meta: {
              "io.modelcontextprotocol/serverInfo": {
                name: "remote-fixture",
                version: "1.0.0",
              },
            },
          });
          return;
        }
        if (message.method === "tools/list") {
          send({
            resultType: "complete",
            tools: [
              {
                name: "echo",
                description: "Echo text",
                inputSchema: {
                  type: "object",
                  properties: { text: { type: "string" } },
                },
                annotations: { readOnlyHint: true },
              },
            ],
            ttlMs: 0,
            cacheScope: "private",
          });
          return;
        }
        if (message.method === "tools/call") {
          const text = String(message.params?.arguments?.text ?? "");
          send({
            resultType: "complete",
            content: [{ type: "text", text }],
            structuredContent: { echoed: text },
            isError: false,
          });
          return;
        }
        response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Remote MCP fixture did not bind a TCP port.");
    }
    endpoint = `http://127.0.0.1:${address.port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("negotiates 2026-07-28, lists tools, calls a tool, and disconnects", async () => {
    const entry = createMcpServerEntry(
      {
        name: "Fixture",
        transport: "streamable-http",
        url: endpoint,
      },
      { id: "fixture" },
    );
    const client = new RemoteMcpClient(entry);
    const discovery = await client.connect();
    expect(discovery.instructions).toBe("Local remote fixture");
    expect(discovery.tools).toHaveLength(1);
    expect(discovery.tools[0]).toMatchObject({
      name: "echo",
      annotations: { readOnlyHint: true },
    });
    const result = await client.callTool("echo", { text: "hello" });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "hello" }],
      structuredContent: { echoed: "hello" },
    });
    await client.close();
  });
});
