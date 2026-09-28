import type { ProjectFiles } from "../ai/generator-types";

const SCANNABLE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|css|scss)$/;

const ESM_FROM = /from\s+(['"])(\.\.?\/[^'"]+)\1/g;
const SIDE_EFFECT_IMPORT = /import\s+(['"])(\.\.?\/[^'"]+)\1/g;
const DYN_IMPORT = /import\s*\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;
const CJS_REQUIRE = /require\s*\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;

const MODULE_SUFFIX_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

interface MoveInfo {
  newPath: string;
  preserveExt: boolean;
  indexShorthand: boolean;
}

// The "__r__" prefix turns an arbitrary project-relative dir into a URL the
// URL parser will accept, so we can lean on it for . / .. normalization.
function resolveRelative(dirname: string, importPath: string): string {
  const base = "file:///__r__/" + (dirname ? dirname + "/" : "");
  const resolved = new URL(importPath, base).pathname;
  const idx = resolved.indexOf("/__r__/");
  return idx === 0 ? resolved.slice("/__r__/".length) : resolved.replace(/^\/+/, "");
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function basenameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function toRelative(
  fromFile: string,
  target: string,
  preserveExt: boolean,
  indexShorthand: boolean,
): string {
  const fromDir = dirname(fromFile);
  const fromParts = fromDir ? fromDir.split("/") : [];
  let toPath = target;
  if (!preserveExt) {
    const m = MODULE_SUFFIX_RE.exec(toPath);
    if (m) toPath = toPath.slice(0, -m[0].length);
  }
  if (indexShorthand && toPath.endsWith("/index")) {
    toPath = toPath.slice(0, -"/index".length);
  }
  const toParts = toPath.split("/");

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const up = fromParts.length - common;
  const down = toParts.slice(common);
  const segments: string[] = [];
  if (up === 0) {
    segments.push(".");
  } else {
    for (let i = 0; i < up; i++) segments.push("..");
  }
  segments.push(...down);
  return segments.join("/");
}

// Pre-compute every resolved-import key that should match each move, so a
// single Map.get can replace the per-move matchOldPath probe.
function buildMoveLookup(moves: Array<[string, string]>): Map<string, MoveInfo> {
  const lookup = new Map<string, MoveInfo>();
  for (const [oldPath, newPath] of moves) {
    lookup.set(oldPath, { newPath, preserveExt: true, indexShorthand: false });
    const m = MODULE_SUFFIX_RE.exec(oldPath);
    if (!m) continue;
    const stem = oldPath.slice(0, -m[0].length);
    if (!lookup.has(stem)) {
      lookup.set(stem, { newPath, preserveExt: false, indexShorthand: false });
    }
    if (stem.endsWith("/index")) {
      const shortKey = stem.slice(0, -"/index".length);
      if (!lookup.has(shortKey)) {
        lookup.set(shortKey, { newPath, preserveExt: false, indexShorthand: true });
      }
    }
  }
  return lookup;
}

function rewriteFile(
  content: string,
  importerPath: string,
  lookup: Map<string, MoveInfo>,
): { content: string; hits: number } {
  let hits = 0;
  const importerDir = dirname(importerPath);

  const replaceFn = (match: string, quote: string, importPath: string) => {
    const resolved = resolveRelative(importerDir, importPath);
    const hit = lookup.get(resolved);
    if (!hit) return match;
    hits++;
    const newRel = toRelative(
      importerPath,
      hit.newPath,
      hit.preserveExt,
      hit.indexShorthand,
    );
    return match.replace(quote + importPath + quote, quote + newRel + quote);
  };

  let next = content.replace(ESM_FROM, replaceFn);
  next = next.replace(SIDE_EFFECT_IMPORT, replaceFn);
  next = next.replace(DYN_IMPORT, replaceFn);
  next = next.replace(CJS_REQUIRE, replaceFn);
  return { content: next, hits };
}

export interface RenamePathResult {
  newFiles: ProjectFiles;
  movedPaths: Array<[string, string]>;
  refCount: number;
  fileCount: number;
}

/** Treat `oldPath` as either a single file or a directory prefix: move all
 *  matching files to `newPath` and rewrite every relative-path import that
 *  pointed at any of them, in a single project-wide sweep. */
export function renamePathInProject(
  files: ProjectFiles,
  oldPath: string,
  newPath: string,
): RenamePathResult {
  const moves: Array<[string, string]> = [];
  const prefix = oldPath + "/";
  for (const key of Object.keys(files)) {
    if (key === oldPath) {
      moves.push([oldPath, newPath]);
    } else if (key.startsWith(prefix)) {
      moves.push([key, newPath + key.slice(oldPath.length)]);
    }
  }

  const movedSources = new Set(moves.map(([from]) => from));
  const newFiles: ProjectFiles = {};
  for (const [path, content] of Object.entries(files)) {
    if (movedSources.has(path)) continue;
    newFiles[path] = content;
  }
  for (const [from, to] of moves) {
    newFiles[to] = files[from];
  }

  const lookup = buildMoveLookup(moves);
  let refCount = 0;
  let fileCount = 0;
  for (const [path, content] of Object.entries(newFiles)) {
    if (!SCANNABLE_EXT_RE.test(path)) continue;
    const { content: nextContent, hits } = rewriteFile(content, path, lookup);
    if (hits === 0) continue;
    newFiles[path] = nextContent;
    refCount += hits;
    fileCount++;
  }

  return { newFiles, movedPaths: moves, refCount, fileCount };
}

export { basenameOf as basename };
