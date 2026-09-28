import { truncateText } from "./network-guard";
import { redactSensitiveText } from "../utils/message-security";

export const CONSOLE_LOG_LIMITS = {
  maxLogs: 30,
  maxItemsPerLog: 8,
  maxItemChars: 500,
  maxOutputChars: 12_000,
} as const;

export interface ConsoleLog {
  method: string;
  data: unknown[];
}

export function stringifyConsoleItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "number" || typeof item === "boolean" || item == null) {
    return String(item);
  }
  if (item instanceof Error) {
    return [item.name, item.message, item.stack].filter(Boolean).join(": ");
  }
  try {
    return JSON.stringify(item);
  } catch {
    try {
      return String(item);
    } catch {
      return "[unserializable]";
    }
  }
}

export function formatConsoleLogLine(log: ConsoleLog): string {
  const method =
    typeof log.method === "string" && log.method.trim()
      ? log.method.trim().toUpperCase()
      : "LOG";
  const data = Array.isArray(log.data) ? log.data : [];
  const limitedItems = data.slice(0, CONSOLE_LOG_LIMITS.maxItemsPerLog);
  const text = limitedItems
    .map((item) => {
      const part = truncateText(
        redactSensitiveText(stringifyConsoleItem(item)),
        CONSOLE_LOG_LIMITS.maxItemChars,
      );
      return part.truncated ? `${part.text} [truncated]` : part.text;
    })
    .join(" ");
  const suffix =
    data.length > limitedItems.length
      ? ` [...${data.length - limitedItems.length} more item(s)]`
      : "";
  return `[${method}] ${text}${suffix}`;
}

export function formatConsoleLogs(logs: ConsoleLog[]): string {
  if (logs.length === 0) return "No console output yet.";
  const visibleLogs = logs.slice(-CONSOLE_LOG_LIMITS.maxLogs);
  const body = visibleLogs.map(formatConsoleLogLine).join("\n");
  const output = truncateText(body, CONSOLE_LOG_LIMITS.maxOutputChars);
  const prefix =
    logs.length > visibleLogs.length
      ? `[showing last ${visibleLogs.length} of ${logs.length} console log(s)]\n`
      : "";
  return `${prefix}${output.text}${output.truncated ? "\n[truncated]" : ""}`;
}
