import { describe, expect, it } from "vitest";
import {
  DEFAULT_ATTACHMENT_CONSTRAINTS,
  isAcceptedFileMime,
  validateAttachmentFile,
} from "./attachments";
import type { Attachment } from "../../types";

describe("attachment validation", () => {
  it("accepts known text-like file types and extension fallback", () => {
    expect(isAcceptedFileMime("application/json", "data.json")).toBe(true);
    expect(isAcceptedFileMime("", "notes.md")).toBe(true);
    expect(isAcceptedFileMime("application/octet-stream", "App.tsx")).toBe(
      true,
    );
    expect(isAcceptedFileMime("application/octet-stream", "app.bin")).toBe(
      false,
    );
  });

  it("rejects count, per-file, and total size limit violations", () => {
    const existing: Attachment[] = Array.from({ length: 8 }, (_, i) => ({
      id: `attachment-${i}`,
      type: "file",
      name: `f${i}.txt`,
      mimeType: "text/plain",
      content: "",
      size: 1,
    }));

    expect(
      validateAttachmentFile(
        new File(["x"], "extra.txt", { type: "text/plain" }),
        existing,
      ),
    ).toMatchObject({ ok: false, code: "max_count" });

    expect(
      validateAttachmentFile(
        new File(
          [new Uint8Array(DEFAULT_ATTACHMENT_CONSTRAINTS.maxFileBytes + 1)],
          "big.txt",
          {
            type: "text/plain",
          },
        ),
        [],
      ),
    ).toMatchObject({ ok: false, code: "max_file_size" });

    expect(
      validateAttachmentFile(
        new File(["x"], "small.txt", { type: "text/plain" }),
        [
          {
            id: "existing",
            type: "file",
            name: "existing.txt",
            mimeType: "text/plain",
            content: "",
            size: DEFAULT_ATTACHMENT_CONSTRAINTS.maxTotalBytes,
          },
        ],
      ),
    ).toMatchObject({ ok: false, code: "max_total_size" });
  });
});
