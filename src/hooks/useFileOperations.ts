import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { GenerationBackend } from "../lib/ai/generator";
import type { ProjectFiles } from "../types";
import { validateProjectFiles } from "../lib/utils/project-files";

interface UseFileOperationsArgs {
  setFiles: Dispatch<SetStateAction<ProjectFiles>>;
  generatorRef: MutableRefObject<GenerationBackend | null>;
}

function commitProjectFiles(
  files: ProjectFiles,
  generatorRef?: MutableRefObject<GenerationBackend | null>,
): { ok: true; files: ProjectFiles } | { ok: false; error: string } {
  const validation = validateProjectFiles(files);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  generatorRef?.current?.setFiles(files);
  return { ok: true, files };
}

function hasProjectPath(files: ProjectFiles, path: string): boolean {
  if (path in files) return true;
  const prefix = path + "/";
  return Object.keys(files).some((key) => key.startsWith(prefix));
}

export function applyProjectFileUpdate(
  files: ProjectFiles,
  path: string,
  content: string,
): ProjectFiles | null {
  const next = { ...files, [path]: content };
  return validateProjectFiles(next).ok ? next : null;
}

export function applyProjectFileRename(
  files: ProjectFiles,
  oldPath: string,
  newPath: string,
): { ok: true; files: ProjectFiles } | { ok: false; error: string } {
  if (oldPath === newPath) return { ok: true, files };
  if (!hasProjectPath(files, oldPath)) {
    return { ok: false, error: `Source path does not exist: ${oldPath}` };
  }
  if (hasProjectPath(files, newPath)) {
    return { ok: false, error: `Target path already exists: ${newPath}` };
  }

  const next: ProjectFiles = {};
  const prefix = oldPath + "/";
  for (const [key, value] of Object.entries(files)) {
    if (key === oldPath) {
      next[newPath] = value;
    } else if (key.startsWith(prefix)) {
      next[newPath + key.slice(oldPath.length)] = value;
    } else {
      next[key] = value;
    }
  }

  const validation = validateProjectFiles(next);
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, files: next };
}

export function applyProjectFileMove(
  files: ProjectFiles,
  sourcePath: string,
  targetFolder: string,
): { ok: true; files: ProjectFiles } | { ok: false; error: string } {
  const fileName = sourcePath.split("/").pop();
  if (!fileName) return { ok: false, error: "Source path must not be empty" };
  const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
  return applyProjectFileRename(files, sourcePath, newPath);
}

/**
 * File system operations that keep the React `files` state and the in-memory
 * generator's `files` map in sync. The generator may be null (no generation
 * has started yet); operations still apply to React state.
 */
export function useFileOperations({
  setFiles,
  generatorRef,
}: UseFileOperationsArgs) {
  const updateFiles = useCallback(
    (path: string, content: string) => {
      setFiles((prev) => {
        const next = applyProjectFileUpdate(prev, path, content);
        if (!next) {
          const validation = validateProjectFiles({ ...prev, [path]: content });
          console.warn(
            "[files] Rejected file update:",
            validation.ok ? "unknown validation error" : validation.error,
          );
          return prev;
        }
        const committed = commitProjectFiles(next, generatorRef);
        if (!committed.ok) {
          console.warn("[files] Rejected file update:", committed.error);
          return prev;
        }
        return committed.files;
      });
    },
    [setFiles, generatorRef],
  );

  const deleteFile = useCallback(
    (path: string) => {
      setFiles((prev) => {
        const next = { ...prev };
        const prefix = path + "/";
        for (const key of Object.keys(next)) {
          if (key === path || key.startsWith(prefix)) {
            delete next[key];
          }
        }
        generatorRef.current?.setFiles(next);
        return next;
      });
    },
    [setFiles, generatorRef],
  );

  const renameFile = useCallback(
    (oldPath: string, newPath: string) => {
      setFiles((prev) => {
        const result = applyProjectFileRename(prev, oldPath, newPath);
        if (!result.ok) {
          console.warn("[files] Rejected file rename:", result.error);
          return prev;
        }
        generatorRef.current?.setFiles(result.files);
        return result.files;
      });
    },
    [setFiles, generatorRef],
  );

  const moveFile = useCallback(
    (sourcePath: string, targetFolder: string) => {
      setFiles((prev) => {
        const result = applyProjectFileMove(prev, sourcePath, targetFolder);
        if (!result.ok) {
          console.warn("[files] Rejected file move:", result.error);
          return prev;
        }
        generatorRef.current?.setFiles(result.files);
        return result.files;
      });
    },
    [setFiles, generatorRef],
  );

  return { updateFiles, deleteFile, renameFile, moveFile };
}
