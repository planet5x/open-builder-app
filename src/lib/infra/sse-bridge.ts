// ============================================================================
//  sse-bridge.ts
//  Bridges Tauri Events into a standard Web Response with ReadableStream body.
//  Used by the proxy interceptor for streaming SSE requests (LLM APIs).
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { nativeSseRevocation } from "../security/native-execution-revocation";

const SSE_CONNECT_TIMEOUT_MS = 30_000;
const SSE_BUFFER_HIGH_WATER_BYTES = 1024 * 1024;
const activeSseCancellations = new Map<string, () => void>();

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function cancelAllNativeSseStreams(): Promise<number> {
  const revocation = nativeSseRevocation.begin();
  try {
    const localCancellations = [...activeSseCancellations.values()];
    for (const cancel of localCancellations) cancel();
    if (!isTauriRuntime()) return localCancellations.length;
    const nativeCount = await invoke<number>("sse_disconnect_all");
    return Math.max(localCancellations.length, nativeCount);
  } finally {
    nativeSseRevocation.finish(revocation);
  }
}

// ─── Types (mirrors Rust SsePayload with serde tag = "type") ────────────────

interface SseConnected {
  type: "Connected";
  status: number;
  headers: Record<string, string>;
}

interface SseChunk {
  type: "Chunk";
  sequence: number;
  bytes: number[]; // Tauri serializes Vec<u8> as number[]
}

interface SseDone {
  type: "Done";
}

interface SseError {
  type: "Error";
  message: string;
}

type SsePayload = SseConnected | SseChunk | SseDone | SseError;

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SseRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/**
 * Create a standard `Response` backed by a Tauri Events → ReadableStream bridge.
 *
 * 1. Registers an event listener for `sse://{id}`
 * 2. Calls `invoke("sse_connect")` to start the Rust-side streaming
 * 3. On `Connected` event → resolves with a `Response(stream, { status, headers })`
 * 4. On `Chunk` events → pushes data into the ReadableStream
 * 5. On `Done` → closes the stream
 * 6. Supports AbortSignal for cancellation
 */
export function createSseResponse(
  options: SseRequestOptions,
): Promise<Response> {
  const executionEpoch = nativeSseRevocation.capture();
  const id = crypto.randomUUID();

  return new Promise<Response>((resolve, reject) => {
    let unlisten: UnlistenFn | null = null;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let resolved = false;
    let cancelled = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanup = () => {};

    const clearConnectTimer = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
    };

    // ── Abort handling ────────────────────────────────────────────────────
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      invoke("sse_disconnect", { id }).catch(() => {});
      const error = new DOMException(
        "The operation was aborted.",
        "AbortError",
      );
      if (!resolved) {
        reject(error);
      } else if (controller) {
        try {
          controller.error(error);
        } catch {
          /* controller may already be closed */
        }
      }
      cleanup();
    };
    const onAbort = () => cancel();

    if (options.signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    cleanup = () => {
      clearConnectTimer();
      unlisten?.();
      unlisten = null;
      options.signal?.removeEventListener("abort", onAbort);
      activeSseCancellations.delete(id);
    };

    // ── ReadableStream ────────────────────────────────────────────────────
    const stream = new ReadableStream<Uint8Array>(
      {
        start(ctrl) {
          controller = ctrl;
        },
        cancel() {
          invoke("sse_disconnect", { id }).catch(() => {});
          cleanup();
        },
      },
      {
        highWaterMark: SSE_BUFFER_HIGH_WATER_BYTES,
        size: (chunk) => chunk.byteLength,
      },
    );
    activeSseCancellations.set(id, cancel);

    // ── Listen for events, then start the Rust-side streaming ────────────
    // listen() is async (IPC to register handler), so we must await it
    // before invoking sse_connect to avoid losing early events.
    listen<SsePayload>(`sse://${id}`, (event) => {
      if (cancelled) return;
      const payload = event.payload;

      switch (payload.type) {
        case "Connected": {
          resolved = true;
          clearConnectTimer();
          const responseHeaders = new Headers(payload.headers);
          resolve(
            new Response(stream, {
              status: payload.status,
              headers: responseHeaders,
            }),
          );
          break;
        }

        case "Chunk": {
          const bytes = new Uint8Array(payload.bytes);
          if (
            controller &&
            controller.desiredSize !== null &&
            controller.desiredSize < bytes.byteLength
          ) {
            const error = new Error("SSE consumer backpressure limit exceeded");
            void invoke("sse_disconnect", { id });
            controller.error(error);
            cleanup();
            break;
          }
          try {
            controller?.enqueue(bytes);
            void invoke("sse_ack", { id, sequence: payload.sequence }).catch(
              () => {},
            );
          } catch {
            /* stream may be cancelled */
          }
          break;
        }

        case "Done": {
          try {
            controller?.close();
          } catch {
            /* may already be closed */
          }
          cleanup();
          break;
        }

        case "Error": {
          const err = new Error(payload.message);
          if (!resolved) {
            reject(err);
          } else {
            try {
              controller?.error(err);
            } catch {
              /* may already be closed */
            }
          }
          cleanup();
          break;
        }
      }
    }).then((fn) => {
      if (cancelled || !nativeSseRevocation.isCurrent(executionEpoch)) {
        cancel();
        fn();
        return;
      }
      unlisten = fn;
      connectTimer = setTimeout(() => {
        invoke("sse_disconnect", { id }).catch(() => {});
        if (!resolved) {
          reject(new Error("SSE connection timed out before headers arrived"));
        }
        cleanup();
      }, SSE_CONNECT_TIMEOUT_MS);

      // Start the Rust-side streaming only after the listener is registered
      invoke("sse_connect", {
        id,
        url: options.url,
        method: options.method,
        headers: options.headers,
        body: options.body ?? null,
      }).catch((err) => {
        if (!resolved) {
          reject(new Error(`SSE connect failed: ${err}`));
        }
        cleanup();
      });
    });
  });
}
