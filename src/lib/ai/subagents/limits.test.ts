import { describe, expect, it } from "vitest";
import {
  SUBAGENT_LIMITS,
  limitSubagentEvents,
  normalizeSubagentTask,
  truncateSubagentText,
} from "./limits";

describe("subagent limits", () => {
  it("normalizes bounded task text", () => {
    expect(normalizeSubagentTask("  inspect src/App.tsx  ")).toEqual({
      ok: true,
      task: "inspect src/App.tsx",
    });
    expect(normalizeSubagentTask("")).toEqual({
      ok: false,
      error: "task must not be empty",
    });
    expect(
      normalizeSubagentTask("x".repeat(SUBAGENT_LIMITS.maxTaskChars + 1)),
    ).toEqual({
      ok: false,
      error: `task is too long (max ${SUBAGENT_LIMITS.maxTaskChars} characters)`,
    });
  });

  it("truncates long subagent text", () => {
    const text = truncateSubagentText("x".repeat(20), 5);

    expect(text).toBe("xxxxx\n\n[truncated]");
  });

  it("limits captured subagent events and previews", () => {
    const events = Array.from(
      { length: SUBAGENT_LIMITS.maxEvents + 1 },
      (_, i) => ({
        name: "read_files",
        toolCallId: String(i),
        resultPreview: "x".repeat(SUBAGENT_LIMITS.maxToolPreviewChars + 1),
      }),
    );

    const result = limitSubagentEvents(events);

    expect(result).toHaveLength(SUBAGENT_LIMITS.maxEvents);
    expect(result[0].resultPreview).toContain("[truncated]");
  });
});
