import { dump as yamlDump } from "js-yaml";
import { z } from "zod";
import type { ImportResult } from "./importer";
import { parseSkillMd } from "./parser";
import { SKILL_IMPORT_LIMITS } from "./paths";
import type { SkillRegistry } from "./registry";
import { skillDisplayTextSchema } from "./display-text";

export interface TextSkillInput {
  name: string;
  description: string;
  instructions: string;
  tags?: string[];
}

const TextSkillInputSchema = z.object({
  name: skillDisplayTextSchema(64),
  description: skillDisplayTextSchema(512),
  instructions: z.string().trim().min(1),
  tags: z
    .array(z.string().trim().min(1).max(SKILL_IMPORT_LIMITS.maxTagChars))
    .max(SKILL_IMPORT_LIMITS.maxTags)
    .optional(),
});

function sanitizeId(rawId: string): string {
  const cleaned = rawId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_IMPORT_LIMITS.maxIdChars);
  return cleaned || "text-skill";
}

function appendSuffix(id: string, suffix: string): string {
  return `${id.slice(0, SKILL_IMPORT_LIMITS.maxIdChars - suffix.length)}${suffix}`;
}

export async function createTextSkill(
  registry: SkillRegistry,
  input: TextSkillInput,
): Promise<ImportResult> {
  const parsed = TextSkillInputSchema.parse(input);
  const tags = parsed.tags
    ? Array.from(new Set(parsed.tags.map((tag) => tag.trim()).filter(Boolean)))
    : [];
  const frontmatter = yamlDump(
    {
      name: parsed.name,
      description: parsed.description,
      version: "1.0.0",
      ...(tags.length > 0 ? { tags } : {}),
    },
    { lineWidth: -1, noRefs: true },
  ).trim();
  const skillMd = `---\n${frontmatter}\n---\n\n${parsed.instructions}\n`;
  parseSkillMd(skillMd);

  const baseId = sanitizeId(parsed.name);
  let id = baseId;
  for (
    let suffix = 2;
    registry.list().some((skill) => skill.id === id);
    suffix++
  ) {
    id = appendSuffix(baseId, `-${suffix}`);
  }

  await registry.writeSkillDirectory(id, { "SKILL.md": skillMd });
  const entry = await registry.registerSkillFromDir(id, "imported");
  return { entry, warnings: [] };
}
