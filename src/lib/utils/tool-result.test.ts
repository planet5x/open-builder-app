import { describe, expect, it } from "vitest";
import {
  createAskUserAnswersToolOutput,
  normalizeToolResultForModel,
  readAskUserAnswerSummary,
  TOOL_RESULT_LIMITS,
} from "./tool-result";

describe("normalizeToolResultForModel", () => {
  it("leaves small tool results untouched", () => {
    expect(normalizeToolResultForModel("OK").result).toBe("OK");
    expect(normalizeToolResultForModel("OK").truncated).toBe(false);
  });

  it("truncates oversized tool results before feeding them back to the model", () => {
    const normalized = normalizeToolResultForModel(
      "x".repeat(TOOL_RESULT_LIMITS.maxModelResultChars + 10),
    );

    expect(normalized.truncated).toBe(true);
    expect(normalized.result).toContain("[tool result truncated after");
    expect(normalized.result.length).toBeLessThan(
      TOOL_RESULT_LIMITS.maxModelResultChars + 100,
    );
  });
});

describe("ask user answer results", () => {
  it("keeps a selection-only structured payload beside the model text", () => {
    const output = createAskUserAnswersToolOutput({
      answers: [
        {
          question: "Choose a runtime?",
          header: "Runtime",
          selected: ["Browser", "Desktop"],
        },
      ],
    });

    expect(output.text).toContain("Q1 [Runtime] Choose a runtime?");
    expect(output.structuredContent).toEqual({
      kind: "ask_user_answers_v1",
      selections: [["Browser", "Desktop"]],
    });
  });

  it("pairs structured selections with supplied headers", () => {
    expect(
      readAskUserAnswerSummary(
        {
          kind: "ask_user_answers_v1",
          selections: [["Browser"], ["Compact"]],
        },
        "",
        ["Runtime", "Layout"],
      ),
    ).toEqual([
      { header: "Runtime", selections: ["Browser"] },
      { header: "Layout", selections: ["Compact"] },
    ]);
  });

  it("recovers headers and answers from legacy text results", () => {
    expect(
      readAskUserAnswerSummary(
        undefined,
        "Q1 [Runtime] Choose a runtime?\n→ Browser\n\nQ2 [Layout] Pick one?\n→ Compact",
      ),
    ).toEqual([
      { header: "Runtime", selections: ["Browser"] },
      { header: "Layout", selections: ["Compact"] },
    ]);
  });
});
