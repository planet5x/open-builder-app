import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ASK_USER_QUESTION_CONTRACT } from "./ask-user-question-contract";
import { BUILTIN_TOOLS } from "./tools-schema";

describe("ask_user_question contract", () => {
  it("is shared by the tool description and preserves the 1-4 question schema", () => {
    expect(BUILTIN_TOOLS.ask_user_question.description).toContain(
      ASK_USER_QUESTION_CONTRACT,
    );

    const schema = z.toJSONSchema(
      BUILTIN_TOOLS.ask_user_question.inputSchema as z.ZodType,
    );
    const questions = schema.properties?.questions as {
      minItems?: number;
      maxItems?: number;
    };
    expect(questions.minItems).toBe(1);
    expect(questions.maxItems).toBe(4);
  });

  it.each([
    "First inspect any project files",
    "Never ask the user for a discoverable fact",
    "batch 1-4 independent questions",
    "ask exactly one question per call",
    '"(Recommended)" or "（推荐）"',
    "observable success criteria",
    "unacceptable failure boundaries",
    "Do not begin implementation before the interview is complete",
  ])("requires %s", (requirement) => {
    expect(ASK_USER_QUESTION_CONTRACT).toContain(requirement);
  });
});
