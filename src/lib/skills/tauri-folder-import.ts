import type { SkillRegistry } from "./registry";
import { importFromStaged, type ImportResult } from "./importer";
import { createSkillImportBudget } from "./import-limits";
import { assertSafePath } from "./paths";

const DIALOG_MODULE_ID = "@tauri-apps/plugin-dialog";
const FS_MODULE_ID = "@tauri-apps/plugin-fs";
const PATH_MODULE_ID = "@tauri-apps/api/path";

interface DialogModule {
  open: (options: {
    directory: boolean;
    multiple: boolean;
  }) => Promise<string | null>;
}

interface FsModule {
  readTextFile: (path: string) => Promise<string>;
  readDir: (
    path: string,
  ) => Promise<
    Array<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink: boolean;
    }>
  >;
  stat: (path: string) => Promise<{ size: number }>;
}

interface PathModule {
  join: (...parts: string[]) => Promise<string>;
  basename: (path: string) => Promise<string>;
}

async function loadDialog(): Promise<DialogModule> {
  return import(/* @vite-ignore */ DIALOG_MODULE_ID);
}

async function loadFs(): Promise<FsModule> {
  return import(/* @vite-ignore */ FS_MODULE_ID);
}

async function loadPath(): Promise<PathModule> {
  return import(/* @vite-ignore */ PATH_MODULE_ID);
}

export async function importFolderViaTauri(
  registry: SkillRegistry,
): Promise<ImportResult | null> {
  const dialog = await loadDialog();
  const selected = await dialog.open({ directory: true, multiple: false });
  if (!selected) return null;

  const fs = await loadFs();
  const pathMod = await loadPath();

  const files: Record<string, string> = {};
  const budget = createSkillImportBudget();

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    const entries = await fs.readDir(absDir);
    for (const entry of entries) {
      const childAbs = await pathMod.join(absDir, entry.name);
      const childRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(childAbs, childRel);
      } else if (entry.isFile) {
        assertSafePath(childRel);
        const stat = await fs.stat(childAbs);
        budget.trackFile(childRel, stat.size);
        files[childRel] = await fs.readTextFile(childAbs);
      }
    }
  }

  await walk(selected, "");
  if (!files["SKILL.md"]) {
    throw new Error("Selected folder is missing SKILL.md at its root.");
  }
  const proposedId = await pathMod.basename(selected);
  return importFromStaged(registry, proposedId, files);
}

const OPENER_MODULE_ID = "@tauri-apps/plugin-opener";

interface OpenerModule {
  openPath: (path: string) => Promise<void>;
  revealItemInDir?: (path: string) => Promise<void>;
}

async function loadOpener(): Promise<OpenerModule> {
  return import(/* @vite-ignore */ OPENER_MODULE_ID);
}

export async function revealSkillsRoot(): Promise<void> {
  const { getSkillsRootPath } = await import("./fs/tauri");
  const root = await getSkillsRootPath();
  const opener = await loadOpener();
  await opener.openPath(root);
}
