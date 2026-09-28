import type { Message } from "../../types";

export interface BufferedAssistantOutput {
  text?: string;
  thinking?: string;
}

/**
 * Persist buffered streaming output, creating the assistant message when a
 * response finishes before the first animation frame is rendered.
 */
export function appendBufferedAssistantOutput(
  messages: Message[],
  output: BufferedAssistantOutput,
): Message[] {
  const text = output.text ?? "";
  const thinking = output.thinking ?? "";
  if (!text && !thinking) return messages;

  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        content: text
          ? `${typeof last.content === "string" ? last.content : ""}${text}`
          : last.content,
        thinking: thinking
          ? `${last.thinking ?? ""}${thinking}`
          : last.thinking,
      },
    ];
  }

  return [
    ...messages,
    {
      role: "assistant",
      content: text || null,
      ...(thinking ? { thinking } : {}),
    },
  ];
}
