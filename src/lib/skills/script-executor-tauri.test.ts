import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  cancelAllNativeSkillScripts,
  TauriScriptExecutor,
} from "./script-executor-tauri";
import type { ScriptExecuteParams } from "./script-executor";
import { nativeSkillScriptRevocation } from "../security/native-execution-revocation";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function params(signal?: AbortSignal): ScriptExecuteParams {
  return {
    skillId: "demo",
    skillName: "Demo",
    skillSource: "imported",
    runId: "run-1",
    callId: "call-1",
    scriptPath: "scripts/demo.js",
    scriptContent: "console.log('ok')",
    args: ["--check"],
    signal,
  };
}

describe("TauriScriptExecutor", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a run/call keyed request to the native command", async () => {
    invokeMock.mockResolvedValue({ stdout: "ok", stderr: "", exit_code: 0 });

    await expect(TauriScriptExecutor.execute(params())).resolves.toMatchObject({
      stdout: "ok",
      exitCode: 0,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "run_skill_script",
      expect.objectContaining({
        req: expect.objectContaining({
          run_id: "run-1",
          call_id: "call-1",
        }),
      }),
    );
  });

  it("cancels the matching native process when the tool signal aborts", async () => {
    const controller = new AbortController();
    let rejectRun: ((reason: unknown) => void) | undefined;
    invokeMock.mockImplementation(async (command) => {
      if (command === "cancel_skill_script") {
        rejectRun?.(new Error("native script cancelled"));
        return true;
      }
      return new Promise((_, reject) => {
        rejectRun = reject;
      });
    });

    const execution = TauriScriptExecutor.execute(params(controller.signal));
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "run_skill_script",
        expect.any(Object),
      );
    });
    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeMock).toHaveBeenCalledWith("cancel_skill_script", {
      runId: "run-1",
      callId: "call-1",
    });
  });

  it("cancels every native Skill process on desktop", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invokeMock.mockImplementation(async (command) => {
      if (command === "mcp_platform_capabilities") {
        return {
          remoteStreaming: true,
          stdio: true,
          oauthLoopback: true,
          skillScripts: true,
          localAgents: true,
        };
      }
      if (command === "cancel_all_skill_scripts") return 2;
    });

    await expect(cancelAllNativeSkillScripts()).resolves.toBe(2);
    expect(invokeMock).toHaveBeenCalledWith("cancel_all_skill_scripts");
  });

  it("does not invoke the desktop-only cancel-all command on mobile", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invokeMock.mockImplementation(async (command) => {
      if (command === "mcp_platform_capabilities") {
        return {
          remoteStreaming: false,
          stdio: false,
          oauthLoopback: false,
          skillScripts: false,
          localAgents: false,
        };
      }
    });

    await expect(cancelAllNativeSkillScripts()).resolves.toBe(0);
    expect(invokeMock).not.toHaveBeenCalledWith("cancel_all_skill_scripts");
  });

  it("does not start a native process while full clear holds the gate", async () => {
    const revocation = nativeSkillScriptRevocation.begin();
    try {
      await expect(TauriScriptExecutor.execute(params())).rejects.toMatchObject(
        { name: "AbortError" },
      );
      expect(invokeMock).not.toHaveBeenCalledWith(
        "run_skill_script",
        expect.anything(),
      );
    } finally {
      nativeSkillScriptRevocation.finish(revocation);
    }
  });
});
