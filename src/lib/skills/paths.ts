export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const SKILL_IMPORT_LIMITS = {
  maxArchiveBytes: 16 * 1024 * 1024,
  maxArchiveEntries: 4096,
  maxCompressionRatio: 200,
  maxFileBytes: MAX_FILE_BYTES,
  maxSkillMdBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxFileCount: 256,
  maxPathChars: 180,
  maxPathDepth: 8,
  maxPathSegmentChars: 80,
  maxIdChars: 80,
  maxFrontmatterBytes: 64 * 1024,
  maxVersionChars: 64,
  maxAuthorChars: 128,
  maxAllowedTools: 64,
  maxAllowedToolChars: 64,
  maxTags: 32,
  maxTagChars: 48,
} as const;

const ALLOWED_RELPATH_RE = /^[a-zA-Z0-9._/-]+$/;

export function assertSafePath(path: string): string {
  if (
    !path ||
    path.includes("..") ||
    path.startsWith("/") ||
    path.includes("\\")
  ) {
    throw new Error(`Unsafe path: "${path}"`);
  }
  if (path.length > SKILL_IMPORT_LIMITS.maxPathChars) {
    throw new Error(
      `Path "${path}" exceeds ${SKILL_IMPORT_LIMITS.maxPathChars} characters.`,
    );
  }
  const segments = path.split("/");
  if (
    segments.length > SKILL_IMPORT_LIMITS.maxPathDepth ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment.length > SKILL_IMPORT_LIMITS.maxPathSegmentChars,
    )
  ) {
    throw new Error(`Unsafe path: "${path}"`);
  }
  if (!ALLOWED_RELPATH_RE.test(path)) {
    throw new Error(
      `Unsafe path "${path}". Only alphanumerics, '.', '_', '-', '/' allowed.`,
    );
  }
  return path;
}

export function textBytes(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

export function extension(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i + 1).toLowerCase();
}
