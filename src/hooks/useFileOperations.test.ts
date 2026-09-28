import { describe, expect, it } from "vitest";
import {
  applyProjectFileMove,
  applyProjectFileRename,
  applyProjectFileUpdate,
} from "./useFileOperations";
import { PROJECT_FILE_LIMITS } from "../lib/utils/project-files";

describe("project file operation guards", () => {
  it("rejects updates that would exceed project file budgets", () => {
    expect(
      applyProjectFileUpdate(
        {},
        "../secret",
        "x",
      ),
    ).toBeNull();

    expect(
      applyProjectFileUpdate(
        {},
        "src/large.ts",
        "x".repeat(PROJECT_FILE_LIMITS.maxFileBytes + 1),
      ),
    ).toBeNull();
  });

  it("renames files and folders without overwriting existing paths", () => {
    const files = {
      "src/App.tsx": "app",
      "src/index.tsx": "index",
      "test/App.tsx": "test",
    };

    expect(
      applyProjectFileRename(files, "src/App.tsx", "src/index.tsx"),
    ).toMatchObject({ ok: false });

    expect(
      applyProjectFileRename(files, "src", "test"),
    ).toMatchObject({ ok: false });

    const renamed = applyProjectFileRename(files, "src", "app");

    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.files).toEqual({
        "app/App.tsx": "app",
        "app/index.tsx": "index",
        "test/App.tsx": "test",
      });
    }
  });

  it("moves files through the same collision and path validation", () => {
    const files = {
      "src/App.tsx": "app",
      "components/App.tsx": "component",
    };

    expect(
      applyProjectFileMove(files, "src/App.tsx", "components"),
    ).toMatchObject({ ok: false });

    expect(
      applyProjectFileMove(files, "src/App.tsx", "../outside"),
    ).toMatchObject({ ok: false });

    const moved = applyProjectFileMove(files, "src/App.tsx", "pages");

    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.files["pages/App.tsx"]).toBe("app");
      expect(moved.files["src/App.tsx"]).toBeUndefined();
    }
  });
});
