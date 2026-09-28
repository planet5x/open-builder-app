import JSZip from "jszip";
import { parseSkillMd } from "./parser";
import type { SkillRegistry } from "./registry";
import type { SkillEntry } from "./types";
import { resolveSkillUrl } from "./url-resolver";
import { SKILL_IMPORT_LIMITS, assertSafePath } from "./paths";
import {
  assertSkillArchiveSize,
  assertSkillArchiveEntryMetadata,
  assertSkillImportEntryCount,
  assertSkillZipCentralDirectory,
  createSkillImportBudget,
  readResponseBytesWithLimit,
  stripCommonZipPrefix,
} from "./import-limits";

export interface ImportResult {
  entry: SkillEntry;
  warnings: string[];
}

function sanitizeId(rawId: string): string {
  const cleaned = rawId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SKILL_IMPORT_LIMITS.maxIdChars);
  return cleaned || "imported-skill";
}

function appendIdSuffix(id: string, suffix: string): string {
  return `${id.slice(0, SKILL_IMPORT_LIMITS.maxIdChars - suffix.length)}${suffix}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

interface StagedSkill {
  proposedId: string;
  files: Record<string, string>;
}

interface ZipEntryWithMetadata extends JSZip.JSZipObject {
  _data?: {
    compressedSize?: number;
    uncompressedSize?: number;
  };
  internalStream(type: "uint8array"): ZipStreamHelper;
}

interface ZipStreamHelper {
  on(event: "data", listener: (chunk: Uint8Array) => void): ZipStreamHelper;
  on(event: "end", listener: () => void): ZipStreamHelper;
  on(event: "error", listener: (error: Error) => void): ZipStreamHelper;
  pause(): ZipStreamHelper;
  resume(): ZipStreamHelper;
}

function zipEntrySizes(file: JSZip.JSZipObject): {
  compressedBytes: number;
  uncompressedBytes: number;
} {
  const metadata = (file as ZipEntryWithMetadata)._data;
  if (
    typeof metadata?.compressedSize !== "number" ||
    typeof metadata.uncompressedSize !== "number"
  ) {
    throw new Error(
      `Zip entry "${file.name}" is missing bounded size metadata.`,
    );
  }
  return {
    compressedBytes: metadata.compressedSize,
    uncompressedBytes: metadata.uncompressedSize,
  };
}

async function decompressZipEntry(
  file: JSZip.JSZipObject,
  path: string,
  budget: ReturnType<typeof createSkillImportBudget>,
): Promise<Uint8Array> {
  const stream = (file as ZipEntryWithMetadata).internalStream("uint8array");
  const tracker = budget.createFileTracker(path);

  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let settled = false;

    const abort = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      chunks.length = 0;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    stream
      .on("data", (chunk) => {
        if (settled) return;
        try {
          tracker.trackChunk(chunk.byteLength);
          chunks.push(chunk);
          totalBytes += chunk.byteLength;
        } catch (error) {
          abort(error);
        }
      })
      .on("error", abort)
      .on("end", () => {
        if (settled) return;
        settled = true;
        const output = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          output.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(output);
      })
      .resume();
  });
}

async function stageZip(
  buffer: ArrayBuffer,
  subpath?: string,
): Promise<StagedSkill> {
  assertSkillArchiveSize(buffer.byteLength);
  assertSkillZipCentralDirectory(buffer, subpath);
  const zip = await JSZip.loadAsync(buffer);
  const entries: { path: string; file: JSZip.JSZipObject }[] = [];
  zip.forEach((path, file) => {
    if (!file.dir) entries.push({ path, file });
  });
  assertSkillImportEntryCount(entries.length);
  if (entries.length === 0) {
    throw new Error("Zip archive contains no files.");
  }
  const { prefix, stripped } = stripCommonZipPrefix(
    entries.map((entry) => entry.path),
  );

  let working = entries.map((e, i) => ({ ...e, strippedPath: stripped[i] }));
  let idHint = prefix.split("/").pop() || "imported-skill";

  if (subpath) {
    const norm = subpath.replace(/^\/+|\/+$/g, "");
    const target = norm + "/";
    working = working
      .filter((w) => w.strippedPath.startsWith(target))
      .map((w) => ({
        ...w,
        strippedPath: w.strippedPath.slice(target.length),
      }));
    if (working.length === 0) {
      throw new Error(
        `Subpath "${subpath}" did not match any files in the archive.`,
      );
    }
    idHint = norm.split("/").pop() || idHint;
  }

  const files: Record<string, string> = {};
  const declaredBudget = createSkillImportBudget();
  const actualBudget = createSkillImportBudget();
  const declaredSizes = new Map<string, number>();
  for (const entry of working) {
    const relPath = entry.strippedPath;
    if (!relPath) continue;
    assertSafePath(relPath);
    const { compressedBytes, uncompressedBytes } = zipEntrySizes(entry.file);
    assertSkillArchiveEntryMetadata(
      relPath,
      compressedBytes,
      uncompressedBytes,
    );
    declaredBudget.trackFile(relPath, uncompressedBytes);
    declaredSizes.set(relPath, uncompressedBytes);
  }
  for (const entry of working) {
    const relPath = entry.strippedPath;
    if (!relPath) continue;
    assertSafePath(relPath);
    const blob = await decompressZipEntry(entry.file, relPath, actualBudget);
    if (blob.byteLength !== declaredSizes.get(relPath)) {
      throw new Error(
        `Zip entry "${relPath}" size changed during decompression.`,
      );
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(blob);
    files[relPath] = text;
  }

  if (!files["SKILL.md"]) {
    throw new Error("Zip is missing SKILL.md at the expected root.");
  }
  return { proposedId: sanitizeId(idHint), files };
}

export async function importFromZip(
  registry: SkillRegistry,
  buffer: ArrayBuffer,
  options?: { subpath?: string },
): Promise<ImportResult> {
  const staged = await stageZip(buffer, options?.subpath);
  return finalizeImport(registry, staged);
}

export async function importFromUrl(
  registry: SkillRegistry,
  url: string,
): Promise<ImportResult> {
  const resolved = resolveSkillUrl(url);
  const res = await fetch(resolved.url, {
    headers: { Accept: "application/vnd.github+json, */*" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch "${resolved.url}": ${res.status} ${res.statusText}`,
    );
  }
  if (resolved.kind === "zip") {
    const bytes = await readResponseBytesWithLimit(
      res,
      SKILL_IMPORT_LIMITS.maxArchiveBytes,
      "Skill archive",
    );
    const buf = toArrayBuffer(bytes);
    return importFromZip(registry, buf, { subpath: resolved.subpath });
  }
  const bytes = await readResponseBytesWithLimit(
    res,
    SKILL_IMPORT_LIMITS.maxSkillMdBytes,
    "SKILL.md",
  );
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const parsed = parseSkillMd(text);
  const proposedId = sanitizeId(parsed.frontmatter.name);
  const staged: StagedSkill = {
    proposedId,
    files: { "SKILL.md": text },
  };
  return finalizeImport(registry, staged);
}

export async function importFromFolder(
  registry: SkillRegistry,
  dirHandle: FileSystemDirectoryHandle,
): Promise<ImportResult> {
  const files: Record<string, string> = {};
  const budget = createSkillImportBudget();
  async function walk(
    handle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<void> {
    for await (const [name, child] of (
      handle as unknown as {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries()) {
      const relPath = prefix ? `${prefix}/${name}` : name;
      if (child.kind === "directory") {
        await walk(child as FileSystemDirectoryHandle, relPath);
      } else {
        assertSafePath(relPath);
        const file = await (child as FileSystemFileHandle).getFile();
        budget.trackFile(relPath, file.size);
        files[relPath] = await file.text();
      }
    }
  }
  await walk(dirHandle, "");
  if (!files["SKILL.md"]) {
    throw new Error("Selected folder is missing SKILL.md at its root.");
  }
  const proposedId = sanitizeId(dirHandle.name);
  return finalizeImport(registry, { proposedId, files });
}

/** Import from a pre-staged file map. Used by Tauri folder import which reads the source via plugin-fs. */
export async function importFromStaged(
  registry: SkillRegistry,
  proposedId: string,
  files: Record<string, string>,
): Promise<ImportResult> {
  if (!files["SKILL.md"]) {
    throw new Error("Imported folder is missing SKILL.md at its root.");
  }
  const budget = createSkillImportBudget();
  for (const path of Object.keys(files)) {
    assertSafePath(path);
    budget.trackFile(path, new TextEncoder().encode(files[path]).byteLength);
  }
  return finalizeImport(registry, {
    proposedId: sanitizeId(proposedId),
    files,
  });
}

async function finalizeImport(
  registry: SkillRegistry,
  staged: StagedSkill,
): Promise<ImportResult> {
  const warnings: string[] = [];
  let id = staged.proposedId;
  const parsed = parseSkillMd(staged.files["SKILL.md"]);
  if (!id) id = sanitizeId(parsed.frontmatter.name);
  const existing = registry.list().find((s) => s.id === id);
  if (existing) {
    if (existing.source === "builtin") {
      id = appendIdSuffix(id, "-imported");
      warnings.push(
        `An installed built-in skill already uses id "${staged.proposedId}". Imported as "${id}".`,
      );
    } else {
      warnings.push(`Replaced existing imported skill "${id}".`);
    }
  }
  await registry.writeSkillDirectory(id, staged.files);
  const entry = await registry.registerSkillFromDir(id, "imported");
  return { entry, warnings };
}
