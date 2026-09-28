import { createPatch } from "diff";
import type { ProjectFiles } from "../../types";

export interface ProjectPatchStats {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

export interface ProjectPatchOptions {
  fromLabel?: string;
  toLabel?: string;
}

export function buildProjectPatch(
  previousFiles: ProjectFiles,
  currentFiles: ProjectFiles,
  options: ProjectPatchOptions = {},
): string {
  const paths = Array.from(
    new Set([...Object.keys(previousFiles), ...Object.keys(currentFiles)]),
  ).sort((a, b) => a.localeCompare(b));

  const patches = paths
    .map((path) => {
      const oldContent = previousFiles[path] ?? "";
      const newContent = currentFiles[path] ?? "";
      if (oldContent === newContent) return "";
      return createPatch(
        path,
        oldContent,
        newContent,
        options.fromLabel ?? "previous",
        options.toLabel ?? "current",
      ).trimEnd();
    })
    .filter(Boolean);

  return patches.join("\n\n") + (patches.length > 0 ? "\n" : "");
}

export function getProjectPatchStats(
  previousFiles: ProjectFiles,
  currentFiles: ProjectFiles,
): ProjectPatchStats {
  const paths = Array.from(
    new Set([...Object.keys(previousFiles), ...Object.keys(currentFiles)]),
  );
  return paths.reduce<ProjectPatchStats>(
    (stats, path) => {
      const existed = path in previousFiles;
      const exists = path in currentFiles;
      if (!existed && exists) stats.added++;
      else if (existed && !exists) stats.deleted++;
      else if (previousFiles[path] !== currentFiles[path]) stats.modified++;
      else stats.unchanged++;
      return stats;
    },
    { added: 0, modified: 0, deleted: 0, unchanged: 0 },
  );
}

export function projectPatchFileName(label: string): string {
  const safe = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safe || "open-builder-changes"}.patch`;
}
