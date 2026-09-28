import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BUILTIN_TOOLS } from "./tools-schema";
import { ASK_USER_QUESTION_CONTRACT } from "./ask-user-question-contract";
import { PLAN_MODE_SYSTEM_SUFFIX, PLAN_OUTPUT_CONTRACT } from "./plan-mode";

describe("Plan Mode prompt contract", () => {
  it("shares the decision-complete contract with the system suffix and exit tool", () => {
    expect(PLAN_MODE_SYSTEM_SUFFIX).toContain(PLAN_OUTPUT_CONTRACT);
    expect(BUILTIN_TOOLS.exit_plan_mode.description).toContain(
      PLAN_OUTPUT_CONTRACT,
    );
    const exitSchema = z.toJSONSchema(
      BUILTIN_TOOLS.exit_plan_mode.inputSchema as z.ZodType,
    );
    expect(
      (exitSchema.properties?.plan as { description?: string }).description,
    ).toContain(PLAN_OUTPUT_CONTRACT);
  });

  it("shares the exploration-first and one-at-a-time grilling contract", () => {
    expect(PLAN_MODE_SYSTEM_SUFFIX).toContain(ASK_USER_QUESTION_CONTRACT);
    expect(PLAN_MODE_SYSTEM_SUFFIX).toContain(
      "a completed interview leads to a decision-complete plan",
    );
  });

  it.each([
    "user-visible outcome",
    "root cause",
    "public interfaces",
    "data flow",
    "edge cases",
    "compatibility or migration",
    "acceptance criteria",
    "assumptions and defaults",
  ])("requires %s", (requirement) => {
    expect(PLAN_OUTPUT_CONTRACT).toContain(requirement);
  });

  it.each([
    {
      scenario: "small bug fix",
      requirements: [
        "current implementation",
        "root cause",
        "success criteria",
      ],
    },
    {
      scenario: "multi-file feature",
      requirements: [
        "grouped by subsystem",
        "affected files or symbols",
        "data flow",
      ],
    },
    {
      scenario: "interface change",
      requirements: [
        "public interfaces",
        "compatibility or migration",
        "edge cases",
      ],
    },
    {
      scenario: "ambiguous request",
      requirements: [
        "assumptions and defaults",
        "high-impact ambiguity",
        "do not ask filler",
      ],
    },
  ])("covers the $scenario static evaluation", ({ requirements }) => {
    for (const requirement of requirements) {
      expect(PLAN_OUTPUT_CONTRACT).toContain(requirement);
    }
  });

  it("keeps planning read-only until an exclusive exit call", () => {
    expect(PLAN_MODE_SYSTEM_SUFFIX).toContain("Research and plan only");
    expect(PLAN_MODE_SYSTEM_SUFFIX).toContain(
      "exit_plan_mode must be the only tool call",
    );
    expect(PLAN_MODE_SYSTEM_SUFFIX).toContain(
      "start implementing only in the next provider iteration",
    );
  });
});
