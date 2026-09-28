import { create } from "zustand";
import {
  CONSOLE_LOG_LIMITS,
  stringifyConsoleItem,
} from "../lib/tools/console-log-format";
import { truncateText } from "../lib/tools/network-guard";

export interface ConsoleLogData {
  method: string;
  data: unknown[];
  id: string;
  timestamp?: number;
}

export function normalizeConsoleLogs(logs: ConsoleLogData[]): ConsoleLogData[] {
  return logs.slice(-CONSOLE_LOG_LIMITS.maxLogs).map((log) => ({
    method:
      typeof log.method === "string" && log.method.trim()
        ? log.method.trim()
        : "log",
    id:
      typeof log.id === "string" && log.id
        ? log.id
        : `log_${Math.random().toString(36).slice(2)}`,
    ...(typeof log.timestamp === "number" ? { timestamp: log.timestamp } : {}),
    data: (Array.isArray(log.data) ? log.data : [])
      .slice(0, CONSOLE_LOG_LIMITS.maxItemsPerLog)
      .map((item) =>
        truncateText(
          stringifyConsoleItem(item),
          CONSOLE_LOG_LIMITS.maxItemChars,
        ).text,
      ),
  }));
}

interface SandpackState {
  consoleLogs: ConsoleLogData[];
  setConsoleLogs: (logs: ConsoleLogData[]) => void;
}

export const useSandpackStore = create<SandpackState>()((set) => ({
  consoleLogs: [],
  setConsoleLogs: (logs) => set({ consoleLogs: normalizeConsoleLogs(logs) }),
}));
