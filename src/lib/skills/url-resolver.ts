export type ResolvedSkillUrl =
  | { kind: "zip"; url: string; subpath?: string }
  | { kind: "raw-skillmd"; url: string };

/**
 * Resolve a user-pasted URL into the form needed for skill import.
 *
 * Accepts:
 *  - github.com/<owner>/<repo>                            → zipball of default branch
 *  - github.com/<owner>/<repo>/tree/<ref>                 → zipball of branch/tag
 *  - github.com/<owner>/<repo>/tree/<ref>/<subpath...>    → zipball + subpath filter
 *  - raw.githubusercontent.com/.../SKILL.md               → raw skill md
 *  - any URL ending in SKILL.md                           → raw skill md
 *  - any URL ending in .zip                               → zip
 *
 * Anything else is treated as a raw SKILL.md so the user sees a real error
 * (parse failure) instead of silent guessing.
 */
export function resolveSkillUrl(input: string): ResolvedSkillUrl {
  const url = input.trim();
  if (!url) {
    throw new Error("URL is empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a valid URL.`);
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").filter(Boolean);

  if (host === "github.com" && segments.length >= 2) {
    const [owner, repo, ...rest] = segments;
    const cleanRepo = repo.replace(/\.git$/, "");
    if (rest.length === 0) {
      return {
        kind: "zip",
        url: `https://api.github.com/repos/${owner}/${cleanRepo}/zipball`,
      };
    }
    if (rest[0] === "tree" && rest.length >= 2) {
      const ref = rest[1];
      const subParts = rest.slice(2);
      return {
        kind: "zip",
        url: `https://api.github.com/repos/${owner}/${cleanRepo}/zipball/${ref}`,
        subpath: subParts.length > 0 ? subParts.join("/") : undefined,
      };
    }
    if (rest[0] === "blob" && rest.length >= 2) {
      const ref = rest[1];
      const filePath = rest.slice(2).join("/");
      if (filePath.toLowerCase().endsWith("skill.md")) {
        return {
          kind: "raw-skillmd",
          url: `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${ref}/${filePath}`,
        };
      }
    }
  }

  if (host === "raw.githubusercontent.com" || /skill\.md$/i.test(path)) {
    return { kind: "raw-skillmd", url };
  }

  if (/\.zip(?:$|\?)/i.test(parsed.pathname + parsed.search)) {
    return { kind: "zip", url };
  }

  return { kind: "raw-skillmd", url };
}
