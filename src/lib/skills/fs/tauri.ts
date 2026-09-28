import type { DirEntry, SkillFs } from "./index";

const SKILLS_DIR = "skills";
const PLUGIN_FS_MODULE_ID = "@tauri-apps/plugin-fs";
const PLUGIN_PATH_MODULE_ID = "@tauri-apps/api/path";

interface PluginFsModule {
  readTextFile: (path: string, options?: { baseDir?: number }) => Promise<string>;
  writeTextFile: (
    path: string,
    contents: string,
    options?: { baseDir?: number },
  ) => Promise<void>;
  readDir: (
    path: string,
    options?: { baseDir?: number },
  ) => Promise<
    Array<{
      name: string;
      isDirectory: boolean;
      isFile: boolean;
      isSymlink: boolean;
    }>
  >;
  mkdir: (
    path: string,
    options?: { baseDir?: number; recursive?: boolean },
  ) => Promise<void>;
  remove: (
    path: string,
    options?: { baseDir?: number; recursive?: boolean },
  ) => Promise<void>;
  exists: (path: string, options?: { baseDir?: number }) => Promise<boolean>;
  BaseDirectory: { AppData: number };
}

interface PluginPathModule {
  appDataDir: () => Promise<string>;
  join: (...parts: string[]) => Promise<string>;
}

let fsModulePromise: Promise<PluginFsModule> | null = null;
let pathModulePromise: Promise<PluginPathModule> | null = null;

async function loadFs(): Promise<PluginFsModule> {
  if (!fsModulePromise) {
    fsModulePromise = import(/* @vite-ignore */ PLUGIN_FS_MODULE_ID);
  }
  return fsModulePromise;
}

async function loadPath(): Promise<PluginPathModule> {
  if (!pathModulePromise) {
    pathModulePromise = import(/* @vite-ignore */ PLUGIN_PATH_MODULE_ID);
  }
  return pathModulePromise;
}

function joinUnder(path: string): string {
  return path ? `${SKILLS_DIR}/${path}` : SKILLS_DIR;
}

export class TauriSkillFs implements SkillFs {
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = (async () => {
      const fs = await loadFs();
      await fs.mkdir(SKILLS_DIR, {
        baseDir: fs.BaseDirectory.AppData,
        recursive: true,
      });
    })();
  }

  private async ready(): Promise<PluginFsModule> {
    await this.readyPromise;
    return loadFs();
  }

  async readFile(path: string): Promise<string> {
    const fs = await this.ready();
    return fs.readTextFile(joinUnder(path), {
      baseDir: fs.BaseDirectory.AppData,
    });
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await this.ready();
    const parts = path.split("/");
    parts.pop();
    if (parts.length > 0) {
      await fs.mkdir(joinUnder(parts.join("/")), {
        baseDir: fs.BaseDirectory.AppData,
        recursive: true,
      });
    }
    await fs.writeTextFile(joinUnder(path), content, {
      baseDir: fs.BaseDirectory.AppData,
    });
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const fs = await this.ready();
    const entries = await fs.readDir(joinUnder(path), {
      baseDir: fs.BaseDirectory.AppData,
    });
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile,
      isDirectory: e.isDirectory,
    }));
  }

  async mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const fs = await this.ready();
    await fs.mkdir(joinUnder(path), {
      baseDir: fs.BaseDirectory.AppData,
      recursive: options?.recursive ?? false,
    });
  }

  async remove(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const fs = await this.ready();
    await fs.remove(joinUnder(path), {
      baseDir: fs.BaseDirectory.AppData,
      recursive: options?.recursive ?? false,
    });
  }

  async exists(path: string): Promise<boolean> {
    const fs = await this.ready();
    return fs.exists(joinUnder(path), {
      baseDir: fs.BaseDirectory.AppData,
    });
  }
}

/** Resolve absolute filesystem path of the skills root. Used for "reveal in Finder". */
export async function getSkillsRootPath(): Promise<string> {
  const pathMod = await loadPath();
  const appDataDir = await pathMod.appDataDir();
  return pathMod.join(appDataDir, SKILLS_DIR);
}
