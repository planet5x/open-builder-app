import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { importFromStaged, importFromZip } from "./importer";
import { SkillRegistry, type SkillsStoreApi } from "./registry";
import type { DirEntry, SkillFs } from "./fs";
import { SKILL_IMPORT_LIMITS } from "./paths";
import type { SkillEntry } from "./types";
import { createSkillImportBudget } from "./import-limits";

class MemorySkillFs implements SkillFs {
  files = new Map<string, string>();
  dirs = new Set<string>();

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`File not found: ${path}`);
    return value;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    const parts = path.split("/");
    parts.pop();
    for (let i = 1; i <= parts.length; i++) {
      this.dirs.add(parts.slice(0, i).join("/"));
    }
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const prefix = path ? `${path}/` : "";
    const names = new Map<string, DirEntry>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const [name, ...tail] = rest.split("/");
      names.set(name, {
        name,
        isFile: tail.length === 0,
        isDirectory: tail.length > 0,
      });
    }
    return Array.from(names.values());
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async remove(path: string): Promise<void> {
    for (const key of Array.from(this.files.keys())) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.files.delete(key);
      }
    }
    for (const key of Array.from(this.dirs.keys())) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.dirs.delete(key);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return (
      this.files.has(path) ||
      this.dirs.has(path) ||
      Array.from(this.files.keys()).some((key) => key.startsWith(`${path}/`))
    );
  }
}

function createRegistry(): {
  fs: MemorySkillFs;
  registry: SkillRegistry;
  store: SkillsStoreApi;
} {
  const fs = new MemorySkillFs();
  const entries = new Map<string, SkillEntry>();
  const store: SkillsStoreApi = {
    getSkill: (id) => entries.get(id),
    listAll: () => Array.from(entries.values()),
    registerSkill: (entry) => {
      entries.set(entry.id, entry);
    },
    unregisterSkill: (id) => {
      entries.delete(id);
    },
    setSkillAutoEnabled: (id, autoEnabled) => {
      const existing = entries.get(id);
      if (existing) entries.set(id, { ...existing, autoEnabled });
    },
  };
  return { fs, registry: new SkillRegistry(fs, store), store };
}

function skillMd(overrides: string[] = []): string {
  return [
    "---",
    "name: Demo Skill",
    "description: Demo description",
    "version:  1.0.0  ",
    "allowed-tools:",
    "  - read_file",
    "  - read_file",
    "tags:",
    "  - react",
    "  - react",
    ...overrides,
    "---",
    "",
    "Use this skill carefully.",
  ].join("\n");
}

function forgeCentralDirectoryUncompressedSize(
  buffer: ArrayBuffer,
  entryName: string,
  forgedSize: number,
): ArrayBuffer {
  const bytes = new Uint8Array(buffer.slice(0));
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) break;
    if (decoder.decode(bytes.subarray(nameStart, nameEnd)) === entryName) {
      view.setUint32(offset + 24, forgedSize, true);
      return bytes.buffer;
    }
    offset = nameEnd + extraLength + commentLength - 1;
  }
  throw new Error(`Central directory entry not found: ${entryName}`);
}

describe("skill importer limits", () => {
  it("rejects oversized zip archives before parsing", async () => {
    const { registry } = createRegistry();

    await expect(
      importFromZip(
        registry,
        new ArrayBuffer(SKILL_IMPORT_LIMITS.maxArchiveBytes + 1),
      ),
    ).rejects.toThrow(/archive exceeds/i);
  });

  it("rejects a many-entry ZIP32 directory before JSZip builds objects", async () => {
    const { registry } = createRegistry();
    const buffer = new ArrayBuffer(22);
    const view = new DataView(buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, SKILL_IMPORT_LIMITS.maxArchiveEntries + 1, true);
    view.setUint16(10, SKILL_IMPORT_LIMITS.maxArchiveEntries + 1, true);

    const loadAsync = vi.spyOn(JSZip, "loadAsync");
    try {
      await expect(importFromZip(registry, buffer)).rejects.toThrow(
        /too many files/i,
      );
      expect(loadAsync).not.toHaveBeenCalled();
    } finally {
      loadAsync.mockRestore();
    }
  });

  it("fails closed on ZIP64 central-directory sentinels", async () => {
    const { registry } = createRegistry();
    const buffer = new ArrayBuffer(22);
    const view = new DataView(buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, 0xffff, true);
    view.setUint16(10, 0xffff, true);
    view.setUint32(12, 0xffffffff, true);
    view.setUint32(16, 0xffffffff, true);

    await expect(importFromZip(registry, buffer)).rejects.toThrow(/ZIP64/i);
  });

  it("rejects imports with too many staged files", async () => {
    const { registry } = createRegistry();
    const files: Record<string, string> = { "SKILL.md": skillMd() };
    for (let i = 0; i < SKILL_IMPORT_LIMITS.maxFileCount; i++) {
      files[`references/ref-${i}.md`] = "ref";
    }

    await expect(importFromStaged(registry, "demo", files)).rejects.toThrow(
      /too many files/i,
    );
  });

  it("rejects oversized SKILL.md files", async () => {
    const { registry } = createRegistry();

    await expect(
      importFromStaged(registry, "demo", {
        "SKILL.md": "x".repeat(SKILL_IMPORT_LIMITS.maxSkillMdBytes + 1),
      }),
    ).rejects.toThrow(/SKILL\.md|File "SKILL\.md"/);
  });

  it("normalizes bounded frontmatter before persistence", async () => {
    const { registry, store } = createRegistry();

    const result = await importFromStaged(registry, "demo", {
      "SKILL.md": skillMd(),
    });

    expect(result.entry.version).toBe("1.0.0");
    expect(result.entry.allowedTools).toEqual(["read_file"]);
    expect(result.entry.tags).toEqual(["react"]);
    expect(result.entry.autoEnabled).toBe(false);
    expect(store.getSkill("demo")).toEqual(result.entry);

    await registry.setAutoEnabled("demo", true);
    expect(registry.getAutoEnabled().map((skill) => skill.id)).toEqual([
      "demo",
    ]);
  });

  it.each([
    ["name", "Demo\\nSpoofed"],
    ["description", "Trusted\\u0007Spoofed"],
    ["name", "Trusted\\u202eSpoofed"],
  ])(
    "rejects control characters in imported %s",
    async (field, escapedValue) => {
      const { registry } = createRegistry();
      const value = JSON.parse(`"${escapedValue}"`) as string;
      const metadata = {
        name: "Demo Skill",
        description: "Demo description",
        [field]: value,
      };
      const raw = [
        "---",
        `name: ${JSON.stringify(metadata.name)}`,
        `description: ${JSON.stringify(metadata.description)}`,
        "---",
        "",
        "Body",
      ].join("\n");

      await expect(
        importFromStaged(registry, "control-character", { "SKILL.md": raw }),
      ).rejects.toThrow(/control or invisible formatting characters/i);
    },
  );

  it("rejects highly compressed entries before allocating their contents", async () => {
    const { registry } = createRegistry();
    const zip = new JSZip();
    zip.file("demo/SKILL.md", skillMd());
    zip.file("demo/references/bomb.txt", "A".repeat(1024 * 1024));
    const buffer = await zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    await expect(importFromZip(registry, buffer)).rejects.toThrow(
      /compression ratio/i,
    );
  });

  it("enforces actual decompressed bytes when zip metadata lies", async () => {
    const { registry } = createRegistry();
    const zip = new JSZip();
    const bombPath = "demo/references/metadata-lie.txt";
    zip.file("demo/SKILL.md", skillMd());
    zip.file(bombPath, "A".repeat(SKILL_IMPORT_LIMITS.maxTotalBytes));
    const honestBuffer = await zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    const forgedBuffer = forgeCentralDirectoryUncompressedSize(
      honestBuffer,
      bombPath,
      1,
    );

    await expect(importFromZip(registry, forgedBuffer)).rejects.toThrow(
      /exceeds 2 MB limit while decompressing/i,
    );
  });

  it("enforces the actual cumulative decompressed-byte budget", () => {
    const budget = createSkillImportBudget();
    budget.createFileTracker("SKILL.md").trackChunk(1);
    for (let index = 0; index < 3; index += 1) {
      budget
        .createFileTracker(`references/chunk-${index}.txt`)
        .trackChunk(SKILL_IMPORT_LIMITS.maxFileBytes);
    }
    const finalTracker = budget.createFileTracker("references/final.txt");

    expect(() =>
      finalTracker.trackChunk(SKILL_IMPORT_LIMITS.maxFileBytes),
    ).toThrow(/total size limit while decompressing/i);
  });

  it("rejects malformed allowed tool names from zip imports", async () => {
    const { registry } = createRegistry();
    const zip = new JSZip();
    zip.file(
      "demo/SKILL.md",
      [
        "---",
        "name: Demo Skill",
        "description: Demo description",
        "allowed-tools:",
        "  - bad tool",
        "---",
        "",
        "Body",
      ].join("\n"),
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });

    await expect(importFromZip(registry, buffer)).rejects.toThrow(
      /allowed-tools/i,
    );
  });

  it("rejects unsafe registered skill ids before reading from disk", async () => {
    const { registry } = createRegistry();

    await expect(registry.readSkillContent("../bad")).rejects.toThrow(
      /Unsafe skill id/,
    );
  });
});
