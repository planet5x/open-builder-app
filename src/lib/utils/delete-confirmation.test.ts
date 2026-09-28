import { describe, expect, it } from "vitest";
import { formatDeleteConfirmation } from "./delete-confirmation";

describe("delete confirmation formatting", () => {
  it("injects the destructive target name into the confirmation copy", () => {
    expect(formatDeleteConfirmation('Delete "{name}"?', "Project A")).toBe(
      'Delete "Project A"?',
    );
  });
});
