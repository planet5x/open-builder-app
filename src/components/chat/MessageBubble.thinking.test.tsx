// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../../store/settings";
import type { MergedMessage } from "../../types";
import { MessageBubble } from "./MessageBubble";

const thinkingMessage: MergedMessage = {
  id: "assistant-1",
  role: "assistant",
  blocks: [
    {
      id: "thinking-1",
      type: "thinking",
      content: "Inspecting the current implementation",
    },
  ],
};

describe("MessageBubble thinking phases", () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
  });

  it("opens only while the active thinking phase is streaming", () => {
    const { rerender } = render(
      <MessageBubble
        message={thinkingMessage}
        isLastAssistant
        isGenerating
        isThinkingStreaming
      />,
    );

    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    rerender(
      <MessageBubble
        message={thinkingMessage}
        isLastAssistant
        isGenerating
        isThinkingStreaming={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    rerender(
      <MessageBubble
        message={thinkingMessage}
        isLastAssistant
        isGenerating
        isThinkingStreaming
      />,
    );
    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("respects manual collapse for the rest of the current phase", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MessageBubble
        message={thinkingMessage}
        isLastAssistant
        isGenerating
        isThinkingStreaming
      />,
    );

    await user.click(screen.getByRole("button", { name: "Thinking" }));
    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    rerender(
      <MessageBubble
        message={{
          ...thinkingMessage,
          blocks: [
            {
              id: "thinking-1",
              type: "thinking",
              content: "Inspecting the current implementation and tests",
            },
          ],
        }}
        isLastAssistant
        isGenerating
        isThinkingStreaming
      />,
    );
    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens only the latest thinking block in the last assistant group", () => {
    render(
      <MessageBubble
        message={{
          ...thinkingMessage,
          blocks: [
            {
              id: "thinking-earlier",
              type: "thinking",
              content: "Earlier phase",
            },
            {
              id: "tool-between",
              type: "tool",
              toolName: "read_file",
              title: "Read File",
              path: "src/App.tsx",
              result: "contents",
              toolCallId: "call-1",
              rawArgs: {},
            },
            {
              id: "thinking-current",
              type: "thinking",
              content: "Current phase",
            },
          ],
        }}
        isLastAssistant
        isGenerating
        isThinkingStreaming
      />,
    );

    const thinkingButtons = screen.getAllByRole("button", {
      name: "Thinking",
    });
    expect(thinkingButtons).toHaveLength(2);
    expect(thinkingButtons[0]).toHaveAttribute("aria-expanded", "false");
    expect(thinkingButtons[1]).toHaveAttribute("aria-expanded", "true");
  });
});
