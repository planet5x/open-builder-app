import type {
  ScriptExecuteParams,
  ScriptExecutor,
  ScriptResult,
} from "./script-executor";
import {
  normalizeScriptResult,
  validateScriptExecuteParams,
} from "./script-execution-guard";
import { extension } from "./paths";
import { invoke } from "@tauri-apps/api/core";
import { getMcpPlatformCapabilities, isTauriMcpHost } from "../mcp/tauri-host";
import { nativeSkillScriptRevocation } from "../security/native-execution-revocation";

interface SkillScriptCommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

const activeNativeScriptCancellations = new Set<() => void>();

function programFor(ext: string): string | null {
  if (ext === "py") return "python3";
  if (ext === "js" || ext === "mjs") return "node";
  if (ext === "sh") return "sh";
  return null;
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException(
    "Skill script execution was cancelled.",
    "AbortError",
  );
}

async function cancelNativeScript(
  runId: string,
  callId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const found = await invoke<boolean>("cancel_skill_script", {
        runId,
        callId,
      });
      if (found) return;
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25 * (attempt + 1));
    });
  }
}

export async function cancelAllNativeSkillScripts(): Promise<number> {
  const revocation = nativeSkillScriptRevocation.begin();
  try {
    const localCancellations = [...activeNativeScriptCancellations];
    for (const cancel of localCancellations) cancel();
    if (!isTauriMcpHost()) return 0;
    const capabilities = await getMcpPlatformCapabilities();
    if (!capabilities.skillScripts) return 0;
    return invoke<number>("cancel_all_skill_scripts");
  } finally {
    nativeSkillScriptRevocation.finish(revocation);
  }
}

export const TauriScriptExecutor: ScriptExecutor = {
  canExecute(scriptPath: string): boolean {
    return programFor(extension(scriptPath)) !== null;
  },
  async execute(params: ScriptExecuteParams): Promise<ScriptResult> {
    validateScriptExecuteParams(params);
    if (params.signal?.aborted) throw abortError(params.signal);
    const ext = extension(params.scriptPath);
    const program = programFor(ext);
    if (!program) {
      return {
        stdout: "",
        stderr: `No interpreter mapping for extension ".${ext}"`,
        exitCode: 1,
      };
    }
    const executionEpoch = nativeSkillScriptRevocation.capture();
    const cancel = () => {
      void cancelNativeScript(params.runId, params.callId);
    };
    activeNativeScriptCancellations.add(cancel);
    params.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const contentHash = await sha256Hex(params.scriptContent);
      if (!nativeSkillScriptRevocation.isCurrent(executionEpoch)) {
        throw new DOMException(
          "Skill script execution was cancelled.",
          "AbortError",
        );
      }
      if (params.signal?.aborted) throw abortError(params.signal);
      const child = await invoke<SkillScriptCommandResult>("run_skill_script", {
        req: {
          skill_id: params.skillId,
          skill_name: params.skillName,
          skill_source: params.skillSource,
          run_id: params.runId,
          call_id: params.callId,
          script_path: params.scriptPath,
          script_content: params.scriptContent,
          content_sha256: contentHash,
          args: params.args,
        },
      });
      return normalizeScriptResult({
        stdout: child.stdout ?? "",
        stderr: child.stderr ?? "",
        exitCode: child.exit_code ?? -1,
      });
    } catch (err: unknown) {
      if (params.signal?.aborted) throw abortError(params.signal);
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        stdout: "",
        stderr: `Failed to invoke ${program}: ${msg}`,
        exitCode: 1,
      };
    } finally {
      activeNativeScriptCancellations.delete(cancel);
      params.signal?.removeEventListener("abort", cancel);
    }
  },
};
