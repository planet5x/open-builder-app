import { describe, expect, it } from "vitest";
import { renamePathInProject } from "./file-refs";
import type { ProjectFiles } from "../ai/generator-types";

describe("renamePathInProject", () => {
  it("updates relative imports for file renames with extensionless references", () => {
    const files: ProjectFiles = {
      "src/App.tsx": 'import { format } from "./utils/date";\nformat();\n',
      "src/utils/date.ts": "export const format = () => 'today';\n",
    };

    const result = renamePathInProject(
      files,
      "src/utils/date.ts",
      "src/lib/date.ts",
    );

    expect(result.movedPaths).toEqual([
      ["src/utils/date.ts", "src/lib/date.ts"],
    ]);
    expect(result.refCount).toBe(1);
    expect(result.newFiles["src/App.tsx"]).toBe(
      'import { format } from "./lib/date";\nformat();\n',
    );
  });

  it("preserves index shorthand imports when moving index modules", () => {
    const files: ProjectFiles = {
      "src/App.tsx": 'import { Button } from "./components";\n',
      "src/components/index.ts": "export const Button = () => null;\n",
    };

    const result = renamePathInProject(
      files,
      "src/components/index.ts",
      "src/ui/index.ts",
    );

    expect(result.newFiles["src/App.tsx"]).toBe(
      'import { Button } from "./ui";\n',
    );
  });

  it("ignores path aliases because only relative imports are safe to rewrite", () => {
    const files: ProjectFiles = {
      "src/App.tsx": 'import { Button } from "@/components/Button";\n',
      "src/components/Button.tsx": "export const Button = () => null;\n",
    };

    const result = renamePathInProject(
      files,
      "src/components/Button.tsx",
      "src/ui/Button.tsx",
    );

    expect(result.refCount).toBe(0);
    expect(result.newFiles["src/App.tsx"]).toBe(files["src/App.tsx"]);
  });
});
