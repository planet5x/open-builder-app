import { describe, expect, it } from "vitest";
import {
  FILE_TREE_VIEW_LIMITS,
  buildTree,
  normalizeFileTreePaths,
} from "./FileTreeView";

describe("FileTreeView guards", () => {
  it("caps rendered path count and reports omitted rows", () => {
    const content = Array.from(
      { length: FILE_TREE_VIEW_LIMITS.maxPaths + 12 },
      (_, i) => `src/${i}.ts`,
    ).join("\n");

    const result = normalizeFileTreePaths(content);

    expect(result.paths).toHaveLength(FILE_TREE_VIEW_LIMITS.maxPaths);
    expect(result.omitted).toBe(12);
  });

  it("bounds path depth, path length and segment length before building a tree", () => {
    const longSegment = "x".repeat(FILE_TREE_VIEW_LIMITS.maxNameChars + 20);
    const content = Array.from(
      { length: FILE_TREE_VIEW_LIMITS.maxDepth + 10 },
      (_, i) => (i === 2 ? longSegment : `dir${i}`),
    ).join("/");

    const [path] = normalizeFileTreePaths(content).paths;
    const parts = path.split("/");

    expect(path.length).toBeLessThanOrEqual(
      FILE_TREE_VIEW_LIMITS.maxPathChars +
        FILE_TREE_VIEW_LIMITS.maxDepth,
    );
    expect(parts.length).toBeLessThanOrEqual(FILE_TREE_VIEW_LIMITS.maxDepth);
    expect(parts[2]).toMatch(/…$/);
  });

  it("keeps normal folder/file rendering data intact", () => {
    const tree = buildTree(["src/App.tsx", "src/lib/util.ts", "README.md"]);

    expect(tree.src).toBeTruthy();
    expect(tree["README.md"]).toBeNull();
    expect((tree.src as Record<string, unknown>)["App.tsx"]).toBeNull();
  });
});
