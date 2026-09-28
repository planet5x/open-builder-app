import { describe, expect, it } from "vitest";
import type { Conversation } from "../../types";
import { messagesForConversationContinuation } from "./conversation-context";

describe("conversation continuation context", () => {
  it("redacts credentials from a legacy compressed summary before replay", () => {
    const sentinel = "legacy-summary-secret-sentinel";
    const conversation: Conversation = {
      id: "conversation-1",
      title: "Legacy",
      messages: [
        { role: "user", content: "Old turn" },
        { role: "assistant", content: "Old reply" },
        { role: "user", content: "Continue safely" },
      ],
      files: {},
      template: "vite-react-ts",
      isProjectInitialized: true,
      compressedContext: {
        fromIndex: 2,
        summary: `Configured credentials: {"client_secret":"${sentinel}"}`,
      },
      createdAt: 1,
      updatedAt: 1,
    };

    const messages = messagesForConversationContinuation(conversation);
    const serialized = JSON.stringify(messages);

    expect(serialized).not.toContain(sentinel);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("Continue safely");
  });
});
