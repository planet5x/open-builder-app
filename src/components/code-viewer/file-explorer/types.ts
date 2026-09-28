import type { ProjectFiles } from "@/types";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
}

export const INDENT = 18;
export const BASE_PAD = 8;

export function buildFileTree(files: ProjectFiles): FileNode[] {
  const root: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  const ensureFolder = (name: string, path: string, level: FileNode[]) => {
    let folder = folderMap.get(path);
    if (!folder) {
      folder = { name, path, type: "folder", children: [] };
      folderMap.set(path, folder);
      level.push(folder);
    }
    return folder;
  };

  for (const path of Object.keys(files).sort()) {
    const cleaned = path.replace(/^\//, "");
    if (cleaned.endsWith("/")) {
      const parts = cleaned.slice(0, -1).split("/");
      let currentLevel = root;
      let currentPath = "";
      for (const part of parts) {
        currentPath += (currentPath ? "/" : "") + part;
        currentLevel = ensureFolder(part, currentPath, currentLevel).children!;
      }
      continue;
    }

    const parts = cleaned.split("/");
    let currentLevel = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += (currentPath ? "/" : "") + part;
      if (i === parts.length - 1) {
        currentLevel.push({ name: part, path: currentPath, type: "file" });
      } else {
        currentLevel = ensureFolder(part, currentPath, currentLevel).children!;
      }
    }
  }

  return root;
}
