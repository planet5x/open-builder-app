import { describe, expect, it } from "vitest";
import {
  buildProjectPatch,
  getProjectPatchStats,
  projectPatchFileName,
} from "./project-patch-export";

describe("project patch export utilities", () => {
  it("builds a unified patch for added, modified and deleted files", () => {
    const patch = buildProjectPatch(
      {
        "README.md": "old\n",
        "src/App.tsx": "one\n",
        "old.txt": "bye\n",
      },
      {
        "README.md": "new\n",
        "src/App.tsx": "one\n",
        "src/new.ts": "fresh\n",
      },
      { fromLabel: "before", toLabel: "after" },
    );

    expect(patch).toContain("Index: README.md");
    expect(patch).toContain("--- README.md\tbefore");
    expect(patch).toContain("+++ README.md\tafter");
    expect(patch).toContain("-old");
    expect(patch).toContain("+new");
    expect(patch).toContain("Index: old.txt");
    expect(patch).toContain("-bye");
    expect(patch).toContain("Index: src/new.ts");
    expect(patch).toContain("+fresh");
    expect(patch).not.toContain("Index: src/App.tsx");
  });

  it("reports patch stats", () => {
    expect(
      getProjectPatchStats(
        { "a.txt": "A", "b.txt": "B", "same.txt": "same" },
        { "a.txt": "A2", "c.txt": "C", "same.txt": "same" },
      ),
    ).toEqual({
      added: 1,
      modified: 1,
      deleted: 1,
      unchanged: 1,
    });
  });

  it("returns empty patch text when nothing changed", () => {
    expect(buildProjectPatch({ "a.txt": "A" }, { "a.txt": "A" })).toBe("");
  });

  it("creates safe patch file names", () => {
    expect(projectPatchFileName("My App! Snapshot")).toBe(
      "my-app-snapshot.patch",
    );
    expect(projectPatchFileName("")).toBe("open-builder-changes.patch");
  });
});
