import { SKILL_IMPORT_LIMITS, assertSafePath, textBytes } from "./paths";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} bytes`;
}

export function assertSkillArchiveSize(byteLength: number): void {
  if (byteLength > SKILL_IMPORT_LIMITS.maxArchiveBytes) {
    throw new Error(
      `Skill archive exceeds ${formatBytes(SKILL_IMPORT_LIMITS.maxArchiveBytes)} limit.`,
    );
  }
}

const ZIP32_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP32_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP32_END_RECORD_BYTES = 22;
const ZIP32_CENTRAL_RECORD_BYTES = 46;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP16_SENTINEL = 0xffff;
const ZIP32_SENTINEL = 0xffffffff;

/**
 * Bounds the object graph JSZip may create before handing the archive to it.
 * Only single-disk ZIP32 is accepted; ZIP64 and ambiguous/trailing structures
 * fail closed because their larger counters need a separate bounded parser.
 */
export function stripCommonZipPrefix(paths: string[]): {
  prefix: string;
  stripped: string[];
} {
  if (paths.length === 0) return { prefix: "", stripped: [] };
  const segments = paths.map((path) => path.split("/"));
  const first = segments[0];
  let common = 0;
  outer: for (let index = 0; index < first.length - 1; index += 1) {
    for (const candidate of segments) {
      if (candidate.length <= index + 1 || candidate[index] !== first[index]) {
        break outer;
      }
    }
    common = index + 1;
  }
  return {
    prefix: first.slice(0, common).join("/"),
    stripped: paths.map((path) => path.split("/").slice(common).join("/")),
  };
}

export function assertSkillZipCentralDirectory(
  buffer: ArrayBuffer,
  subpath?: string,
): void {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < ZIP32_END_RECORD_BYTES) {
    throw new Error("Skill archive has an invalid ZIP central directory.");
  }

  const view = new DataView(buffer);
  const searchStart = bytes.byteLength - ZIP32_END_RECORD_BYTES;
  const searchEnd = Math.max(0, searchStart - ZIP_MAX_COMMENT_BYTES);
  let endOffset = -1;
  for (let offset = searchStart; offset >= searchEnd; offset -= 1) {
    if (
      view.getUint32(offset, true) === ZIP32_END_OF_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      const commentBytes = view.getUint16(offset + 20, true);
      if (offset + ZIP32_END_RECORD_BYTES + commentBytes === bytes.byteLength) {
        endOffset = offset;
        break;
      }
    }
  }
  if (endOffset < 0) {
    throw new Error("Skill archive has an invalid ZIP central directory.");
  }

  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralDirectoryBytes = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries
  ) {
    throw new Error("Multi-disk Skill ZIP archives are not supported.");
  }
  if (
    entriesOnDisk === ZIP16_SENTINEL ||
    totalEntries === ZIP16_SENTINEL ||
    centralDirectoryBytes === ZIP32_SENTINEL ||
    centralDirectoryOffset === ZIP32_SENTINEL
  ) {
    throw new Error("ZIP64 Skill archives are not supported.");
  }

  // Check the count before walking records or calling JSZip.loadAsync().
  assertSkillImportEntryCount(totalEntries);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectoryBytes;
  if (
    !Number.isSafeInteger(centralDirectoryEnd) ||
    centralDirectoryOffset > endOffset ||
    centralDirectoryEnd !== endOffset
  ) {
    throw new Error("Skill archive has an invalid ZIP central directory.");
  }

  let offset = centralDirectoryOffset;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: {
    path: string;
    compressedBytes: number;
    uncompressedBytes: number;
  }[] = [];
  for (let index = 0; index < totalEntries; index += 1) {
    if (
      offset + ZIP32_CENTRAL_RECORD_BYTES > centralDirectoryEnd ||
      view.getUint32(offset, true) !== ZIP32_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error("Skill archive has an invalid ZIP central directory.");
    }
    const compressedBytes = view.getUint32(offset + 20, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    if (
      compressedBytes === ZIP32_SENTINEL ||
      uncompressedBytes === ZIP32_SENTINEL
    ) {
      throw new Error("ZIP64 Skill archives are not supported.");
    }
    const nameBytes = view.getUint16(offset + 28, true);
    const extraBytes = view.getUint16(offset + 30, true);
    const commentBytes = view.getUint16(offset + 32, true);
    const recordBytes =
      ZIP32_CENTRAL_RECORD_BYTES + nameBytes + extraBytes + commentBytes;
    if (offset + recordBytes > centralDirectoryEnd) {
      throw new Error("Skill archive has an invalid ZIP central directory.");
    }
    const nameStart = offset + ZIP32_CENTRAL_RECORD_BYTES;
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(nameStart, nameStart + nameBytes));
    } catch {
      throw new Error("Skill archive contains an invalid UTF-8 entry path.");
    }
    if (!path.endsWith("/")) {
      entries.push({ path, compressedBytes, uncompressedBytes });
    }
    offset += recordBytes;
  }
  if (offset !== centralDirectoryEnd) {
    throw new Error("Skill archive has an invalid ZIP central directory.");
  }

  const { stripped } = stripCommonZipPrefix(entries.map((entry) => entry.path));
  let working = entries.map((entry, index) => ({
    ...entry,
    strippedPath: stripped[index],
  }));
  if (subpath) {
    const target = `${subpath.replace(/^\/+|\/+$/g, "")}/`;
    working = working
      .filter((entry) => entry.strippedPath.startsWith(target))
      .map((entry) => ({
        ...entry,
        strippedPath: entry.strippedPath.slice(target.length),
      }));
  }
  const budget = createSkillImportBudget();
  for (const entry of working) {
    if (!entry.strippedPath) continue;
    assertSafePath(entry.strippedPath);
    assertSkillArchiveEntryMetadata(
      entry.strippedPath,
      entry.compressedBytes,
      entry.uncompressedBytes,
    );
    budget.trackFile(entry.strippedPath, entry.uncompressedBytes);
  }
}

export function assertSkillImportEntryCount(count: number): void {
  if (count > SKILL_IMPORT_LIMITS.maxArchiveEntries) {
    throw new Error(
      `Skill archive contains too many files (max ${SKILL_IMPORT_LIMITS.maxArchiveEntries}).`,
    );
  }
}

export function assertSkillArchiveEntryMetadata(
  path: string,
  compressedBytes: number,
  uncompressedBytes: number,
): void {
  if (
    !Number.isSafeInteger(compressedBytes) ||
    !Number.isSafeInteger(uncompressedBytes) ||
    compressedBytes < 0 ||
    uncompressedBytes < 0
  ) {
    throw new Error(`Zip entry "${path}" has invalid size metadata.`);
  }
  if (uncompressedBytes === 0) return;
  if (compressedBytes === 0) {
    throw new Error(`Zip entry "${path}" has an invalid compression ratio.`);
  }
  const ratio = uncompressedBytes / compressedBytes;
  if (ratio > SKILL_IMPORT_LIMITS.maxCompressionRatio) {
    throw new Error(
      `Zip entry "${path}" exceeds the ${SKILL_IMPORT_LIMITS.maxCompressionRatio}:1 compression ratio limit.`,
    );
  }
}

export function createSkillImportBudget(): {
  trackFile: (path: string, byteLength: number) => void;
  createFileTracker: (path: string) => {
    trackChunk: (byteLength: number) => void;
  };
} {
  let fileCount = 0;
  let totalBytes = 0;

  function beginFile(path: string): number {
    const perFileLimit =
      path === "SKILL.md"
        ? SKILL_IMPORT_LIMITS.maxSkillMdBytes
        : SKILL_IMPORT_LIMITS.maxFileBytes;
    fileCount += 1;
    if (fileCount > SKILL_IMPORT_LIMITS.maxFileCount) {
      throw new Error(
        `Skill import contains too many files (max ${SKILL_IMPORT_LIMITS.maxFileCount}).`,
      );
    }
    return perFileLimit;
  }

  function validateByteLength(path: string, byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error(`File "${path}" produced an invalid byte length.`);
    }
  }

  return {
    trackFile(path: string, byteLength: number): void {
      validateByteLength(path, byteLength);
      const perFileLimit = beginFile(path);
      if (byteLength > perFileLimit) {
        throw new Error(
          `File "${path}" exceeds ${formatBytes(perFileLimit)} limit.`,
        );
      }
      const nextTotalBytes = totalBytes + byteLength;
      if (nextTotalBytes > SKILL_IMPORT_LIMITS.maxTotalBytes) {
        throw new Error(
          `Skill import exceeds ${formatBytes(SKILL_IMPORT_LIMITS.maxTotalBytes)} total size limit.`,
        );
      }
      totalBytes = nextTotalBytes;
    },
    createFileTracker(path: string) {
      const perFileLimit = beginFile(path);
      let fileBytes = 0;
      return {
        trackChunk(byteLength: number): void {
          validateByteLength(path, byteLength);
          const nextFileBytes = fileBytes + byteLength;
          if (nextFileBytes > perFileLimit) {
            throw new Error(
              `File "${path}" exceeds ${formatBytes(perFileLimit)} limit while decompressing.`,
            );
          }
          const nextTotalBytes = totalBytes + byteLength;
          if (nextTotalBytes > SKILL_IMPORT_LIMITS.maxTotalBytes) {
            throw new Error(
              `Skill import exceeds ${formatBytes(SKILL_IMPORT_LIMITS.maxTotalBytes)} total size limit while decompressing.`,
            );
          }
          fileBytes = nextFileBytes;
          totalBytes = nextTotalBytes;
        },
      };
    },
  };
}

export function assertSkillMdSize(raw: string): void {
  const size = textBytes(raw);
  if (size > SKILL_IMPORT_LIMITS.maxSkillMdBytes) {
    throw new Error(
      `SKILL.md exceeds ${formatBytes(SKILL_IMPORT_LIMITS.maxSkillMdBytes)} limit.`,
    );
  }
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`${label} exceeds ${formatBytes(maxBytes)} limit.`);
    }
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`${label} exceeds ${formatBytes(maxBytes)} limit.`);
    }
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds ${formatBytes(maxBytes)} limit.`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
