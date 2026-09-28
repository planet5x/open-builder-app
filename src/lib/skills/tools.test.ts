import { describe, expect, it } from "vitest";
import { getSkillTools, SKILL_TOOL_NAMES } from "./tools";

describe("skill tool platform policy", () => {
  it("does not expose script execution on web", () => {
    expect(getSkillTools(false)).toHaveProperty(SKILL_TOOL_NAMES.LIST);
    expect(getSkillTools(false)).toHaveProperty(SKILL_TOOL_NAMES.READ);
    expect(getSkillTools(false)).not.toHaveProperty(
      SKILL_TOOL_NAMES.EXECUTE_SCRIPT,
    );
  });

  it("exposes script execution on desktop", () => {
    expect(getSkillTools(true)).toHaveProperty(
      SKILL_TOOL_NAMES.EXECUTE_SCRIPT,
    );
  });
});
