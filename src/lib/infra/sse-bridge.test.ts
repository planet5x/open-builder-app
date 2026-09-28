import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: undefined as
    ((event: { payload: Record<string, unknown> }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, listener: typeof tauri.listener) => {
    tauri.listener = listener;
    return tauri.unlisten;
  }),
}));

import { cancelAllNativeSseStreams, createSseResponse } from "./sse-bridge";
import { nativeSseRevocation } from "../security/native-execution-revocation";

describe("native SSE bridge flow control", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.unlisten.mockClear();
    tauri.listener = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("acknowledges each native chunk after enqueueing it", async () => {
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "sse_connect") {
        tauri.listener?.({
          payload: { type: "Connected", status: 200, headers: {} },
        });
        tauri.listener?.({
          payload: { type: "Chunk", sequence: 7, bytes: [111, 107] },
        });
        tauri.listener?.({ payload: { type: "Done" } });
      }
    });

    const response = await createSseResponse({
      url: "https://api.example.com/stream",
      method: "POST",
      headers: {},
    });
    await expect(response.text()).resolves.toBe("ok");
    expect(tauri.invoke).toHaveBeenCalledWith("sse_ack", {
      id: expect.any(String),
      sequence: 7,
    });
  });

  it("full clear rejects pending JS streams and cancels all native streams", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "sse_disconnect_all") return 1;
    });
    const response = createSseResponse({
      url: "https://api.example.com/stream",
      method: "POST",
      headers: {},
    });
    await vi.waitFor(() => expect(tauri.listener).toBeTypeOf("function"));

    await expect(cancelAllNativeSseStreams()).resolves.toBe(1);
    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    expect(tauri.invoke).toHaveBeenCalledWith("sse_disconnect_all");
  });

  it("does not start a native AI stream while full clear holds the gate", () => {
    const revocation = nativeSseRevocation.begin();
    try {
      expect(() =>
        createSseResponse({
          url: "https://api.example.com/stream",
          method: "POST",
          headers: {},
        }),
      ).toThrow(/cancelled/i);
      expect(tauri.invoke).not.toHaveBeenCalledWith(
        "sse_connect",
        expect.anything(),
      );
    } finally {
      nativeSseRevocation.finish(revocation);
    }
  });
});
