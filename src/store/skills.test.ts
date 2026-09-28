import { describe, expect, it } from "vitest";
import { migrateSkillsState } from "./skills-migrations";

describe("skills store migration", () => {
  it("maps enabled to autoEnabled and removes the script warning state", () => {
    const migrated = migrateSkillsState({
      skills: {
        demo: {
          id: "demo",
          enabled: false,
          builtinVersion: "1.0.0",
        },
      },
      scriptWarningAcknowledged: true,
    }) as Record<string, any>;

    expect(migrated.skills.demo).toMatchObject({
      id: "demo",
      autoEnabled: false,
      cachedVersion: "1.0.0",
    });
    expect(migrated.skills.demo).not.toHaveProperty("enabled");
    expect(migrated.skills.demo).not.toHaveProperty("builtinVersion");
    expect(migrated).not.toHaveProperty("scriptWarningAcknowledged");
  });
});
