import type { DirEntry, SkillFs } from "./index";

const ROOT_DIR_NAME = "skills";

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

async function traverse(
  start: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = start;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

export class OPFSSkillFs implements SkillFs {
  private rootPromise: Promise<FileSystemDirectoryHandle>;

  constructor() {
    this.rootPromise = (async () => {
      const opfsRoot = await navigator.storage.getDirectory();
      return opfsRoot.getDirectoryHandle(ROOT_DIR_NAME, { create: true });
    })();
  }

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    return this.rootPromise;
  }

  async readFile(path: string): Promise<string> {
    const root = await this.getRoot();
    const parts = splitPath(path);
    const filename = parts.pop();
    if (!filename) throw new Error(`Invalid file path: "${path}"`);
    const dir = await traverse(root, parts, false);
    const fileHandle = await dir.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const root = await this.getRoot();
    const parts = splitPath(path);
    const filename = parts.pop();
    if (!filename) throw new Error(`Invalid file path: "${path}"`);
    const dir = await traverse(root, parts, true);
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const root = await this.getRoot();
    const parts = splitPath(path);
    const dir = await traverse(root, parts, false);
    const entries: DirEntry[] = [];
    for await (const [name, handle] of (
      dir as unknown as {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries()) {
      entries.push({
        name,
        isFile: handle.kind === "file",
        isDirectory: handle.kind === "directory",
      });
    }
    return entries;
  }

  async mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const root = await this.getRoot();
    const parts = splitPath(path);
    if (parts.length === 0) return;
    if (options?.recursive) {
      await traverse(root, parts, true);
      return;
    }
    const last = parts.pop()!;
    const dir = await traverse(root, parts, false);
    await dir.getDirectoryHandle(last, { create: true });
  }

  async remove(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const root = await this.getRoot();
    const parts = splitPath(path);
    const target = parts.pop();
    if (!target) throw new Error(`Cannot remove root path: "${path}"`);
    const dir = await traverse(root, parts, false);
    await dir.removeEntry(target, { recursive: options?.recursive ?? false });
  }

  async exists(path: string): Promise<boolean> {
    try {
      const root = await this.getRoot();
      const parts = splitPath(path);
      const target = parts.pop();
      if (!target) return true;
      const dir = await traverse(root, parts, false);
      try {
        await dir.getFileHandle(target);
        return true;
      } catch {
        try {
          await dir.getDirectoryHandle(target);
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      return false;
    }
  }
}
