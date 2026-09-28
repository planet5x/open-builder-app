import { afterEach, describe, expect, it } from "vitest";
import { skillActiveContext } from "./active-context";
import type { SkillEntry } from "./types";

function skill(id: string, allowedTools?: string[]): SkillEntry {
  return {
    id,
    name: id,
    description: id,
    version: "1.0.0",
    allowedTools,
    autoEnabled: true,
    source: "imported",
    installedAt: 1,
  };
}

afterEach(() => skillActiveContext.clear());

describe("skill active context", () => {
  it("keeps multiple active skills and unions declared tools", () => {
    skillActiveContext.activateMany([
      skill("review", ["read_files", "search_in_files"]),
      skill("fix", ["read_files", "patch_file"]),
    ]);

    expect(skillActiveContext.get()).toMatchObject({
      restrictTools: true,
      allowedTools: ["read_files", "search_in_files", "patch_file"],
    });
    expect(skillActiveContext.isActive("review")).toBe(true);
    expect(skillActiveContext.isActive("fix")).toBe(true);
  });

  it("activates unrestricted skills without enabling a whitelist", () => {
    skillActiveContext.activate(skill("guidance"));
    expect(skillActiveContext.get()?.restrictTools).toBe(false);
  });
});
