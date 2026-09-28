import { describe, expect, it } from "vitest";
import type { SkillEntry } from "./types";
import {
  filterAndSortSkillCatalog,
  summarizeSkillCatalog,
} from "./catalog";

const skills: SkillEntry[] = [
  skill({
    id: "react",
    name: "React Patterns",
    source: "builtin",
    allowedTools: ["read_file"],
    autoEnabled: true,
    installedAt: 10,
  }),
  skill({
    id: "imported-shell",
    name: "Imported Shell",
    source: "imported",
    allowedTools: ["read_file", "write_file", "execute_skill_script"],
    autoEnabled: false,
    installedAt: 30,
  }),
  skill({
    id: "wide",
    name: "Wide Permissions",
    source: "builtin",
    allowedTools: ["a", "b", "c", "d"],
    tags: ["review"],
    autoEnabled: true,
    installedAt: 20,
  }),
];

const details = {
  "imported-shell": {
    references: ["refs/api.md"],
    scripts: ["scripts/run.sh"],
  },
};

describe("skill catalog utilities", () => {
  it("summarizes local skill catalog signals", () => {
    expect(summarizeSkillCatalog(skills, details)).toEqual({
      total: 3,
      autoEnabled: 2,
      builtin: 2,
      imported: 1,
      withScripts: 1,
    });
  });

  it("filters by source, automatic matching state and scripts", () => {
    expect(
      filterAndSortSkillCatalog(skills, details, { filter: "auto" }).map(
        (item) => item.skill.id,
      ),
    ).toEqual(["react", "wide"]);
    expect(
      filterAndSortSkillCatalog(skills, details, { filter: "imported" }).map(
        (item) => item.skill.id,
      ),
    ).toEqual(["imported-shell"]);
    expect(
      filterAndSortSkillCatalog(skills, details, { filter: "scripts" }).map(
        (item) => item.skill.id,
      ),
    ).toEqual(["imported-shell"]);
  });

  it("searches skill metadata and sorts by permission count", () => {
    expect(
      filterAndSortSkillCatalog(skills, details, {
        query: "review",
        sort: "permissions",
      }).map((item) => item.skill.id),
    ).toEqual(["wide"]);
    expect(
      filterAndSortSkillCatalog(skills, details, {
        sort: "permissions",
      }).map((item) => item.skill.id),
    ).toEqual(["wide", "imported-shell", "react"]);
  });

  it("classifies local execution risk", () => {
    const items = filterAndSortSkillCatalog(skills, details);
    expect(items.map((item) => [item.skill.id, item.risk])).toEqual([
      ["react", "low"],
      ["wide", "medium"],
      ["imported-shell", "high"],
    ]);
  });
});

function skill(overrides: Partial<SkillEntry>): SkillEntry {
  return {
    id: "skill",
    name: "Skill",
    description: "A skill",
    version: "1.0.0",
    allowedTools: [],
    tags: [],
    autoEnabled: true,
    source: "builtin",
    installedAt: 1,
    ...overrides,
  };
}
