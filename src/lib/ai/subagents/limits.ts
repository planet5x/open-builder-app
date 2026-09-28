import type { SubagentEvent } from "./types";

export const SUBAGENT_LIMITS = {
  maxTaskChars: 4_000,
  maxLiveTextChars: 8_000,
  maxEvents: 40,
  maxToolPreviewChars: 1_000,
  maxErrorChars: 1_000,
} as const;

export function normalizeSubagentTask(
  value: unknown,
): { ok: true; task: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "task must be a string" };
  }
  const task = value.trim();
  if (!task) return { ok: false, error: "task must not be empty" };
  if (task.length > SUBAGENT_LIMITS.maxTaskChars) {
    return {
      ok: false,
      error: `task is too long (max ${SUBAGENT_LIMITS.maxTaskChars} characters)`,
    };
  }
  return { ok: true, task };
}

export function truncateSubagentText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

export function limitSubagentEvents(events: SubagentEvent[]): SubagentEvent[] {
  return events.slice(0, SUBAGENT_LIMITS.maxEvents).map((event) => ({
    ...event,
    resultPreview: truncateSubagentText(
      event.resultPreview,
      SUBAGENT_LIMITS.maxToolPreviewChars,
    ),
  }));
}
