import { z } from "zod";
import { load as yamlLoad, YAMLException } from "js-yaml";
import { assertSkillMdSize } from "./import-limits";
import { SKILL_IMPORT_LIMITS, textBytes } from "./paths";
import { skillDisplayTextSchema } from "./display-text";

const TOOL_NAME_RE = /^[a-zA-Z0-9_.:-]+$/;

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function boundedToken(maxChars: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxChars)
    .regex(
      TOOL_NAME_RE,
      "must contain only letters, digits, '.', '_', '-' or ':'",
    );
}

export const SkillFrontmatterSchema = z.object({
  name: skillDisplayTextSchema(64),
  description: skillDisplayTextSchema(512),
  version: z
    .string()
    .trim()
    .min(1)
    .max(SKILL_IMPORT_LIMITS.maxVersionChars)
    .optional()
    .default("1.0.0"),
  author: z.string().trim().max(SKILL_IMPORT_LIMITS.maxAuthorChars).optional(),
  "allowed-tools": z
    .array(boundedToken(SKILL_IMPORT_LIMITS.maxAllowedToolChars))
    .max(SKILL_IMPORT_LIMITS.maxAllowedTools)
    .transform(unique)
    .optional(),
  tags: z
    .array(z.string().trim().min(1).max(SKILL_IMPORT_LIMITS.maxTagChars))
    .max(SKILL_IMPORT_LIMITS.maxTags)
    .transform(unique)
    .optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMd(raw: string): ParsedSkill {
  assertSkillMdSize(raw);
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) {
    throw new Error(
      "SKILL.md must begin with a YAML frontmatter block delimited by '---'",
    );
  }
  const [, fmRaw, body] = m;
  if (textBytes(fmRaw) > SKILL_IMPORT_LIMITS.maxFrontmatterBytes) {
    throw new Error(
      `SKILL.md frontmatter exceeds ${SKILL_IMPORT_LIMITS.maxFrontmatterBytes} byte limit.`,
    );
  }
  let fmObj: unknown;
  try {
    fmObj = yamlLoad(fmRaw);
  } catch (err) {
    const msg = err instanceof YAMLException ? err.message : String(err);
    throw new Error(`Failed to parse SKILL.md frontmatter: ${msg}`, {
      cause: err,
    });
  }
  if (!fmObj || typeof fmObj !== "object" || Array.isArray(fmObj)) {
    throw new Error("SKILL.md frontmatter must be a YAML mapping.");
  }
  const frontmatter = SkillFrontmatterSchema.parse(fmObj);
  return { frontmatter, body: body.replace(/^\r?\n/, "") };
}
