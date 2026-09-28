import { z } from "zod";
import { readResponseBytesWithLimit } from "./import-limits";
import { SKILL_IMPORT_LIMITS, assertSafePath } from "./paths";
import type { SkillManifest, SkillManifestEntry } from "./types";
import { skillDisplayTextSchema } from "./display-text";

const token = z.string().trim().min(1);

const SkillManifestEntrySchema = z
  .object({
    id: token.max(SKILL_IMPORT_LIMITS.maxIdChars).regex(/^[a-zA-Z0-9._-]+$/),
    name: skillDisplayTextSchema(64),
    description: skillDisplayTextSchema(512),
    version: token.max(SKILL_IMPORT_LIMITS.maxVersionChars),
    allowedTools: z
      .array(token.max(SKILL_IMPORT_LIMITS.maxAllowedToolChars))
      .max(SKILL_IMPORT_LIMITS.maxAllowedTools)
      .optional(),
    tags: z
      .array(token.max(SKILL_IMPORT_LIMITS.maxTagChars))
      .max(SKILL_IMPORT_LIMITS.maxTags)
      .optional(),
    entry: token.transform(assertSafePath),
    files: z
      .array(token.transform(assertSafePath))
      .min(1)
      .max(SKILL_IMPORT_LIMITS.maxFileCount),
  })
  .superRefine((entry, ctx) => {
    if (!entry.files.includes(entry.entry)) {
      ctx.addIssue({
        code: "custom",
        message: `files must include entry "${entry.entry}"`,
        path: ["files"],
      });
    }
    const prefix = `${entry.id}/`;
    if (!entry.entry.startsWith(prefix)) {
      ctx.addIssue({
        code: "custom",
        message: `entry must be inside "${entry.id}/"`,
        path: ["entry"],
      });
    }
    for (const file of entry.files) {
      if (!file.startsWith(prefix)) {
        ctx.addIssue({
          code: "custom",
          message: `file "${file}" must be inside "${entry.id}/"`,
          path: ["files"],
        });
      }
    }
    if (new Set(entry.files).size !== entry.files.length) {
      ctx.addIssue({
        code: "custom",
        message: "files must not contain duplicates",
        path: ["files"],
      });
    }
  });

const SkillManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    skills: z.array(SkillManifestEntrySchema),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    for (const [index, skill] of manifest.skills.entries()) {
      if (ids.has(skill.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate skill id "${skill.id}"`,
          path: ["skills", index, "id"],
        });
      }
      ids.add(skill.id);
    }
  });

export type SkillFetch = typeof fetch;

export function resolvePublicSkillUrl(
  path: string,
  baseUrl = import.meta.env.BASE_URL,
  pageUrl = typeof window !== "undefined"
    ? window.location.href
    : "http://localhost/",
): string {
  const safe = assertSafePath(path);
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(`${normalizedBase}skills/${safe}`, pageUrl).href;
}

export async function loadSkillManifest(
  fetcher: SkillFetch = fetch,
): Promise<SkillManifest> {
  const response = await fetcher(resolvePublicSkillUrl("manifest.json"), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to load skills manifest: ${response.status} ${response.statusText}`,
    );
  }
  const bytes = await readResponseBytesWithLimit(
    response,
    SKILL_IMPORT_LIMITS.maxSkillMdBytes,
    "Skills manifest",
  );
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse skills manifest: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return SkillManifestSchema.parse(parsed) as SkillManifest;
}

export async function downloadManifestSkillFiles(
  manifest: SkillManifestEntry,
  platform: "web" | "desktop",
  fetcher: SkillFetch = fetch,
): Promise<Record<string, string>> {
  const paths = platform === "web" ? [manifest.entry] : manifest.files;
  const budget = { total: 0 };
  const entries = await Promise.all(
    paths.map(async (path) => {
      const response = await fetcher(resolvePublicSkillUrl(path), {
        headers: { Accept: "text/plain, */*" },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to download skill file "${path}": ${response.status} ${response.statusText}`,
        );
      }
      const maxBytes =
        path === manifest.entry
          ? SKILL_IMPORT_LIMITS.maxSkillMdBytes
          : SKILL_IMPORT_LIMITS.maxFileBytes;
      const bytes = await readResponseBytesWithLimit(response, maxBytes, path);
      budget.total += bytes.byteLength;
      if (budget.total > SKILL_IMPORT_LIMITS.maxTotalBytes) {
        throw new Error("Downloaded skill exceeds total size limit.");
      }
      const prefix = `${manifest.id}/`;
      const relativePath = path.slice(prefix.length);
      return [
        assertSafePath(relativePath),
        new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
