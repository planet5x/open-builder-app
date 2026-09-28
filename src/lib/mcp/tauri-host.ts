import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FetchLike } from "@modelcontextprotocol/client";
import type {
  McpCallToolResultLike,
  McpServerDiscovery,
  McpServerEntry,
} from "./types";

export interface McpPlatformCapabilities {
  remoteStreaming: boolean;
  stdio: boolean;
  oauthLoopback: boolean;
  skillScripts: boolean;
  localAgents: boolean;
}

interface RemoteEventPayload {
  type: "Connected" | "Chunk" | "Done" | "Error";
  status?: number;
  headers?: Record<string, string>;
  data?: number[];
  sequence?: number;
  message?: string;
}

const MCP_STREAM_BUFFER_HIGH_WATER_BYTES = 1024 * 1024;
let mcpPolicySync: Promise<void> = Promise.resolve();

function enqueueMcpPolicyOperation(
  operation: () => Promise<unknown>,
): Promise<void> {
  const next = mcpPolicySync
    .catch(() => {})
    .then(operation)
    .then(() => {});
  mcpPolicySync = next.catch(() => {});
  return next;
}

export function isTauriMcpHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getMcpPlatformCapabilities(): Promise<McpPlatformCapabilities> {
  if (!isTauriMcpHost()) {
    return {
      remoteStreaming: false,
      stdio: false,
      oauthLoopback: false,
      skillScripts: false,
      localAgents: false,
    };
  }
  return invoke<McpPlatformCapabilities>("mcp_platform_capabilities");
}

function knownRequestBodyBytes(
  body: BodyInit | null | undefined,
): number[] | null {
  if (body == null) return null;
  if (typeof body === "string")
    return Array.from(new TextEncoder().encode(body));
  if (body instanceof Uint8Array) return Array.from(body);
  if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    return Array.from(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  if (body instanceof URLSearchParams) {
    return Array.from(new TextEncoder().encode(body.toString()));
  }
  throw new Error(
    "Desktop MCP bridge does not support streaming request bodies.",
  );
}

async function requestBodyBytes(
  request: Request,
  explicitBody: BodyInit | null | undefined,
): Promise<number[] | null> {
  if (explicitBody !== undefined && explicitBody !== null) {
    return knownRequestBodyBytes(explicitBody);
  }
  if (!request.body) return null;
  return Array.from(new Uint8Array(await request.clone().arrayBuffer()));
}

function headersRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

/** Fetch-compatible bridge used only by MCP transports. It is independent of
 * the app's reverse-proxy preference and scoped by the server's Rust allowlist. */
export function createTauriMcpFetch(
  serverId: string,
  initialOrigins: string[],
  confirmCrossOrigin?: (origin: string) => boolean | Promise<boolean>,
  sharedAllowedOrigins?: Set<string>,
  credentialsConfigured = false,
  lifecycleGuard?: () => boolean,
): FetchLike {
  const allowedOrigins = sharedAllowedOrigins ?? new Set<string>();
  for (const origin of initialOrigins) allowedOrigins.add(origin);
  return async (input, init) => {
    if (lifecycleGuard && !lifecycleGuard()) {
      throw new DOMException("MCP lifecycle was revoked.", "AbortError");
    }
    const request = input instanceof Request ? input : new Request(input, init);
    const origin = new URL(request.url).origin;
    if (!allowedOrigins.has(origin)) {
      const approved = await (confirmCrossOrigin?.(origin) ?? false);
      if (!approved) {
        throw new Error(`MCP cross-origin request was not approved: ${origin}`);
      }
      allowedOrigins.add(origin);
      await setTauriMcpRemotePolicy(
        serverId,
        [...allowedOrigins],
        credentialsConfigured,
        lifecycleGuard,
      );
    }
    const requestId = crypto.randomUUID();
    const eventName = `mcp-remote://${requestId}`;
    let unlisten: UnlistenFn | undefined;
    let settled = false;
    let aborted = false;
    let rejectResponse: ((reason?: unknown) => void) | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

    const cleanup = () => {
      unlisten?.();
      unlisten = undefined;
      request.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      aborted = true;
      void invoke("mcp_remote_disconnect", { id: requestId });
      const error = new DOMException("Aborted", "AbortError");
      if (settled) controller?.error(error);
      else rejectResponse?.(error);
      cleanup();
    };

    return new Promise<Response>((resolve, reject) => {
      rejectResponse = reject;
      void (async () => {
        try {
          unlisten = await listen<RemoteEventPayload>(eventName, (event) => {
            const payload = event.payload;
            switch (payload.type) {
              case "Connected": {
                if (settled) return;
                settled = true;
                const status = payload.status ?? 200;
                const bodyAllowed =
                  status !== 204 && status !== 205 && status !== 304;
                const stream = bodyAllowed
                  ? new ReadableStream<Uint8Array>(
                      {
                        start(value) {
                          controller = value;
                        },
                        cancel() {
                          cleanup();
                          return invoke("mcp_remote_disconnect", {
                            id: requestId,
                          });
                        },
                      },
                      {
                        highWaterMark: MCP_STREAM_BUFFER_HIGH_WATER_BYTES,
                        size: (chunk) => chunk.byteLength,
                      },
                    )
                  : null;
                resolve(
                  new Response(stream, {
                    status,
                    headers: payload.headers,
                  }),
                );
                break;
              }
              case "Chunk": {
                if (payload.sequence === undefined) {
                  void invoke("mcp_remote_disconnect", { id: requestId });
                  controller?.error(
                    new Error(
                      "Desktop MCP stream event is missing its sequence.",
                    ),
                  );
                  cleanup();
                  break;
                }
                if (payload.data?.length) {
                  const bytes = Uint8Array.from(payload.data);
                  if (
                    controller &&
                    controller.desiredSize !== null &&
                    controller.desiredSize < bytes.byteLength
                  ) {
                    const error = new Error(
                      "Desktop MCP consumer backpressure limit exceeded",
                    );
                    void invoke("mcp_remote_disconnect", { id: requestId });
                    controller.error(error);
                    cleanup();
                    break;
                  }
                  controller?.enqueue(bytes);
                }
                void invoke("mcp_remote_ack", {
                  id: requestId,
                  sequence: payload.sequence,
                }).catch(() => {});
                break;
              }
              case "Done":
                controller?.close();
                cleanup();
                break;
              case "Error": {
                const error = new Error(
                  payload.message || "Desktop MCP request failed.",
                );
                if (settled) controller?.error(error);
                else reject(error);
                cleanup();
                break;
              }
            }
          });
          request.signal.addEventListener("abort", onAbort, { once: true });
          if (request.signal.aborted) {
            onAbort();
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          const body = await requestBodyBytes(request, init?.body);
          const expectedEpoch = await invoke<number>("mcp_remote_policy_epoch");
          if (lifecycleGuard && !lifecycleGuard()) {
            throw new DOMException("MCP lifecycle was revoked.", "AbortError");
          }
          await invoke("mcp_remote_connect", {
            id: requestId,
            serverId,
            expectedEpoch,
            url: request.url,
            method: request.method,
            headers: headersRecord(request.headers),
            body,
          });
          if (aborted) {
            await invoke("mcp_remote_disconnect", { id: requestId });
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      })();
    });
  };
}

export async function setTauriMcpRemotePolicy(
  serverId: string,
  origins: string[],
  credentialsConfigured = false,
  lifecycleGuard?: () => boolean,
): Promise<void> {
  await enqueueMcpPolicyOperation(async () => {
    if (lifecycleGuard && !lifecycleGuard()) {
      throw new DOMException("MCP lifecycle was revoked.", "AbortError");
    }
    const expectedEpoch = await invoke<number>("mcp_remote_policy_epoch");
    if (lifecycleGuard && !lifecycleGuard()) {
      throw new DOMException("MCP lifecycle was revoked.", "AbortError");
    }
    await invoke("mcp_remote_set_policy", {
      serverId,
      origins,
      credentialsConfigured,
      expectedEpoch,
    });
  });
}

export async function clearTauriMcpRemotePolicies(): Promise<void> {
  if (!isTauriMcpHost()) return;
  await enqueueMcpPolicyOperation(async () => {
    const capabilities = await getMcpPlatformCapabilities();
    await Promise.all([
      capabilities.remoteStreaming
        ? invoke<number>("mcp_remote_clear_policies")
        : Promise.resolve(),
      capabilities.stdio
        ? invoke<number>("mcp_stdio_disconnect_all")
        : Promise.resolve(),
    ]);
  });
}

export interface TauriStdioConnectionResult extends McpServerDiscovery {
  serverInfo?: { name?: string; version?: string };
}

export async function connectTauriStdio(
  entry: McpServerEntry,
  lifecycleGuard?: () => boolean,
): Promise<TauriStdioConnectionResult> {
  const expectedEpoch = await invoke<number>("mcp_stdio_connection_epoch");
  if (lifecycleGuard && !lifecycleGuard()) {
    throw new DOMException("MCP lifecycle was revoked.", "AbortError");
  }
  return invoke<TauriStdioConnectionResult>("mcp_stdio_connect", {
    config: {
      id: entry.id,
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env ?? {},
      cwd: entry.cwd,
    },
    expectedEpoch,
  });
}

export async function listTauriStdioTools(
  serverId: string,
): Promise<McpServerDiscovery> {
  return invoke<McpServerDiscovery>("mcp_stdio_list_tools", { serverId });
}

export async function callTauriStdioTool(
  serverId: string,
  callId: string,
  name: string,
  args: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<McpCallToolResultLike> {
  const onAbort = () => {
    void invoke("mcp_stdio_cancel", { serverId, callId });
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return await invoke<McpCallToolResultLike>("mcp_stdio_call_tool", {
      serverId,
      callId,
      name,
      arguments:
        args && typeof args === "object" ? args : ({} as Record<string, never>),
      timeoutMs,
    });
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function disconnectTauriStdio(serverId: string): Promise<void> {
  await invoke("mcp_stdio_disconnect", { serverId });
}

export interface TauriOAuthLoopback {
  redirectUri: string;
  callback: Promise<URLSearchParams>;
  cancel: () => Promise<void>;
}

export async function startTauriOAuthLoopback(
  requestId: string,
  timeoutMs = 120_000,
): Promise<TauriOAuthLoopback> {
  let unlisten: UnlistenFn | undefined;
  let resolveCallback!: (params: URLSearchParams) => void;
  let rejectCallback!: (reason?: unknown) => void;
  const callback = new Promise<URLSearchParams>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  try {
    unlisten = await listen<
      | { type: "Callback"; url: string }
      | { type: "Timeout" }
      | { type: "Cancelled" }
      | { type: "Error"; message: string }
    >(`mcp-oauth://${requestId}`, ({ payload }) => {
      unlisten?.();
      switch (payload.type) {
        case "Callback":
          resolveCallback(new URL(payload.url).searchParams);
          break;
        case "Timeout":
          rejectCallback(new Error("Desktop OAuth callback timed out."));
          break;
        case "Cancelled":
          rejectCallback(
            new DOMException("OAuth callback cancelled.", "AbortError"),
          );
          break;
        case "Error":
          rejectCallback(new Error(payload.message));
          break;
      }
    });
    const started = await invoke<{ redirectUri: string }>(
      "mcp_oauth_start_loopback",
      { requestId, timeoutMs },
    );
    return {
      redirectUri: started.redirectUri,
      callback,
      cancel: async () => {
        unlisten?.();
        await invoke("mcp_oauth_cancel_loopback", { requestId });
      },
    };
  } catch (error) {
    unlisten?.();
    throw error;
  }
}
