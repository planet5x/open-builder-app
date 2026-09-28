import { describe, expect, it } from "vitest";
import type { MemoryItem } from "../../types";
import {
  MEMORY_LIMITS,
  limitMemoriesForPrompt,
  sanitizeMemoryOperations,
} from "./memory-limits";

describe("memory limits", () => {
  it("sanitizes valid memory operations", () => {
    const result = sanitizeMemoryOperations(
      [
        {
          action: "add",
          content: "  The user prefers concise Chinese summaries.  ",
          category: "preference",
        },
      ],
      0,
    );

    expect(result).toEqual({
      ok: true,
      operations: [
        {
          action: "add",
          content: "The user prefers concise Chinese summaries.",
          category: "preference",
        },
      ],
    });
  });

  it("rejects over-budget memory writes", () => {
    expect(
      sanitizeMemoryOperations(
        Array.from({ length: MEMORY_LIMITS.maxOperations + 1 }, () => ({
          action: "delete",
          id: "memory-id",
        })),
        0,
      ),
    ).toEqual({
      ok: false,
      error: `too many memory operations (max ${MEMORY_LIMITS.maxOperations})`,
    });

    expect(
      sanitizeMemoryOperations(
        [
          {
            action: "add",
            content: "x".repeat(MEMORY_LIMITS.maxContentChars + 1),
            category: "fact",
          },
        ],
        0,
      ),
    ).toEqual({
      ok: false,
      error: `operation #1 content is too long (max ${MEMORY_LIMITS.maxContentChars} characters)`,
    });

    expect(
      sanitizeMemoryOperations(
        [{ action: "add", content: "new memory", category: "fact" }],
        MEMORY_LIMITS.maxItems,
      ),
    ).toEqual({
      ok: false,
      error: `too many memories (max ${MEMORY_LIMITS.maxItems})`,
    });
  });

  it("bounds memories included in prompts", () => {
    const memories: MemoryItem[] = Array.from(
      { length: MEMORY_LIMITS.maxItems + 1 },
      (_, i) => ({
        id: String(i),
        category: "fact",
        content: "x".repeat(MEMORY_LIMITS.maxContentChars + 10),
        createdAt: i,
        updatedAt: i,
      }),
    );

    const result = limitMemoriesForPrompt(memories);

    expect(result).toHaveLength(MEMORY_LIMITS.maxItems);
    expect(result[0].content).toHaveLength(MEMORY_LIMITS.maxContentChars);
  });
});
