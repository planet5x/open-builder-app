import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import {
  findAssistantGroupEnd,
  getMergedMessageStartIndex,
} from "./message-navigation";

describe("message navigation", () => {
  it("parses supported merged message ids strictly", () => {
    expect(getMergedMessageStartIndex("assistant-12")).toBe(12);
    expect(getMergedMessageStartIndex("user-0")).toBe(0);
    expect(getMergedMessageStartIndex("tool-call-12")).toBeNull();
    expect(getMergedMessageStartIndex("assistant-last")).toBeNull();
  });

  it("finds the end of an assistant/tool group", () => {
    const messages: Message[] = [
      { role: "user", content: "build" },
      {
        role: "assistant",
        content: "working",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_files", arguments: "{}" },
          },
        ],
      },
      { role: "tool", content: "ok", tool_call_id: "call-1" },
      { role: "assistant", content: "done" },
      { role: "user", content: "next" },
    ];

    expect(findAssistantGroupEnd(messages, "assistant-1")).toBe(4);
  });

  it("falls back to the message end for invalid ids", () => {
    const messages: Message[] = [{ role: "user", content: "hello" }];

    expect(findAssistantGroupEnd(messages, "user-0")).toBe(messages.length);
    expect(findAssistantGroupEnd(messages, "assistant-latest")).toBe(
      messages.length,
    );
  });
});
