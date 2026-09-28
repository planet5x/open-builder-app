import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSkillMd } from "./parser";
import type { SkillManifest } from "./types";
import { resolvePublicSkillUrl } from "./manifest";
import { FORCED_SKILLS_MAX_BYTES } from "./registry";

const publicRoot = new URL("../../../public/skills/", import.meta.url);

function readPublic(path: string): string {
  return readFileSync(new URL(path, publicRoot), "utf8");
}

describe("public skills manifest", () => {
  it("matches every shipped SKILL.md and declared file", () => {
    const manifest = JSON.parse(readPublic("manifest.json")) as SkillManifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(new Set(manifest.skills.map((skill) => skill.id)).size).toBe(
      manifest.skills.length,
    );

    for (const skill of manifest.skills) {
      expect(() => readPublic(skill.entry)).not.toThrow();
      for (const file of skill.files) {
        expect(() => readPublic(file)).not.toThrow();
      }
      const parsed = parseSkillMd(readPublic(skill.entry)).frontmatter;
      expect(parsed.name).toBe(skill.name);
      expect(parsed.description).toBe(skill.description);
      expect(parsed.version).toBe(skill.version);
      expect(parsed["allowed-tools"] ?? []).toEqual(skill.allowedTools ?? []);
      expect(parsed.tags ?? []).toEqual(skill.tags ?? []);
    }
  });

  it("resolves public assets under nested Vite base paths", () => {
    expect(
      resolvePublicSkillUrl(
        "react-patterns/SKILL.md",
        "/open-builder/",
        "https://example.com/open-builder/index.html",
      ),
    ).toBe("https://example.com/open-builder/skills/react-patterns/SKILL.md");
  });

  it("ships the four adapted built-ins without standalone grill or Karpathy skills", () => {
    const manifest = JSON.parse(readPublic("manifest.json")) as SkillManifest;
    const ids = manifest.skills.map((skill) => skill.id);
    const adaptedIds = [
      "design-taste-frontend",
      "frontend-design",
      "code-review",
      "code-simplifier",
    ];

    expect(ids).toEqual(expect.arrayContaining(adaptedIds));
    expect(ids).not.toContain("grill-me");
    expect(ids).not.toContain("karpathy-guidelines");
    for (const id of adaptedIds) {
      const entry = manifest.skills.find((skill) => skill.id === id);
      expect(entry?.version).toBe("1.0.0");
      expect(entry?.files).toEqual(
        expect.arrayContaining([`${id}/SOURCE.md`, `${id}/LICENSE.txt`]),
      );
      expect(entry).not.toHaveProperty("defaultAutoEnabled");
    }
  });

  it("keeps all four adapted bodies within the combined forced-prompt budget", () => {
    const manifest = JSON.parse(readPublic("manifest.json")) as SkillManifest;
    const adaptedIds = new Set([
      "design-taste-frontend",
      "frontend-design",
      "code-review",
      "code-simplifier",
    ]);
    const combined = manifest.skills
      .filter((skill) => adaptedIds.has(skill.id))
      .map((skill) => parseSkillMd(readPublic(skill.entry)).body)
      .join("");

    expect(new TextEncoder().encode(combined).byteLength).toBeLessThanOrEqual(
      FORCED_SKILLS_MAX_BYTES,
    );
  });

  it("keeps the Open Builder compatibility edits in each adapted body", () => {
    const body = (id: string) =>
      parseSkillMd(readPublic(`${id}/SKILL.md`)).body;

    expect(body("design-taste-frontend")).toContain(
      "existing stack and conventions",
    );
    expect(body("design-taste-frontend")).toContain(
      "Use `frontend-design` for routine product UI",
    );

    expect(body("frontend-design")).toContain(
      "Use this skill for ordinary product UI",
    );
    expect(body("frontend-design")).not.toContain("Claude is capable");

    expect(body("code-review")).not.toContain("/code-review");
    expect(body("code-review")).not.toContain("@$1");
    expect(body("code-review")).not.toContain("CONNECTORS.md");
    expect(body("code-review")).toContain(
      "Review and report; do not edit files",
    );

    expect(body("code-simplifier")).toContain("`AGENTS.md`, `CLAUDE.md`");
    expect(body("code-simplifier")).toContain(
      "code modified in the current request",
    );
  });
});
