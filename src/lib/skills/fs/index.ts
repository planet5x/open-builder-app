import { OPFSSkillFs } from "./opfs";
import { TauriSkillFs } from "./tauri";

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface SkillFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** True if skills storage is available in this environment (Tauri FS or OPFS). */
export function isSkillsAvailable(): boolean {
  return isTauri() || isOpfsAvailable();
}

let skillFsInstance: SkillFs | null = null;

export function createSkillFs(): SkillFs {
  if (skillFsInstance) return skillFsInstance;
  if (isTauri()) {
    skillFsInstance = new TauriSkillFs();
    return skillFsInstance;
  }
  if (!isOpfsAvailable()) {
    throw new Error(
      "Skills storage is not available in this environment (neither Tauri FS nor OPFS).",
    );
  }
  skillFsInstance = new OPFSSkillFs();
  return skillFsInstance;
}
