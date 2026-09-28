// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../../store/settings";
import { useInteractiveStore } from "../../store/interactive";
import type { MergedMessage } from "../../types";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble ask-user answers", () => {
  beforeEach(() => {
    useInteractiveStore.setState({ pending: [] });
    useSettingsStore.setState((state) => ({
      system: { ...state.system, language: "en" },
    }));
  });

  it("shows only the short header and final answer", () => {
    const message: MergedMessage = {
      id: "assistant-1",
      role: "assistant",
      blocks: [
        {
          id: "tool-question-1",
          type: "tool",
          toolName: "ask_user_question",
          title: "Ask You a Question",
          path: "",
          toolCallId: "question-1",
          result: "Q1 [Runtime] Where should it run?\n→ Browser",
          rawArgs: {
            questions: [
              {
                header: "Runtime",
                question: "Where should it run?",
                multiSelect: false,
                options: [
                  { label: "Browser", description: "Browser runtime." },
                ],
              },
            ],
          },
          toolOutput: {
            text: "Q1 [Runtime] Where should it run?\n→ Browser",
            structuredContent: {
              kind: "ask_user_answers_v1",
              selections: [["Browser"]],
            },
          },
        },
      ],
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByLabelText("Your answers")).toHaveTextContent(
      "Runtime: Browser",
    );
    expect(screen.queryByText("Where should it run?")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser runtime.")).not.toBeInTheDocument();
    expect(screen.queryByText("Ask You a Question")).not.toBeInTheDocument();
  });

  it("recovers a legacy header and answer without structured content", () => {
    const message: MergedMessage = {
      id: "assistant-legacy",
      role: "assistant",
      blocks: [
        {
          id: "tool-question-legacy",
          type: "tool",
          toolName: "ask_user_question",
          title: "Ask You a Question",
          path: "",
          toolCallId: "question-legacy",
          result: "Q1 [Layout] Pick a layout?\n→ Compact",
        },
      ],
    };

    render(<MessageBubble message={message} />);

    expect(screen.getByLabelText("Your answers")).toHaveTextContent(
      "Layout: Compact",
    );
  });
});
