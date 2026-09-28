import type { RuntimePlatform } from "../ai/tools-schema";
import { getMcpPlatformCapabilities, isTauriMcpHost } from "../mcp/tauri-host";

let platformPromise: Promise<RuntimePlatform> | null = null;

export function detectRuntimePlatform(): Promise<RuntimePlatform> {
  platformPromise ??= (async () => {
    if (!isTauriMcpHost()) return "web";
    try {
      const capabilities = await getMcpPlatformCapabilities();
      return capabilities.stdio ? "desktop" : "mobile";
    } catch {
      // A Tauri host without desktop capabilities is treated as mobile and
      // therefore never receives stdio or script execution tools.
      return "mobile";
    }
  })();
  return platformPromise;
}

export function resetRuntimePlatformForTesting(): void {
  platformPromise = null;
}
