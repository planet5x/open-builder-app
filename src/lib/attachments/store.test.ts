import { describe, expect, it } from "vitest";
import { getUnreferencedAttachmentIds } from "./store";
import type { Message } from "../ai/generator-types";

function messageWithAttachment(id: string): Message {
  return {
    role: "user",
    content: "Review this file",
    metadata: {
      attachments: [
        {
          id,
          type: "file",
          name: `${id}.pdf`,
          mimeType: "application/pdf",
          size: 10,
        },
      ],
    },
  };
}

describe("attachment reference collection", () => {
  it("preserves shared attachment ids across forked conversation messages", () => {
    const original = [messageWithAttachment("shared")];
    const fork = [...original];

    expect(getUnreferencedAttachmentIds(fork, original)).toEqual([]);
    expect(getUnreferencedAttachmentIds(fork, [])).toEqual(["shared"]);
  });
});
