import type { Message } from "./generator-types";

export function isGenerationRunCurrent(
  runConversationId: string | null,
  activeConversationId: string | null,
  currentRunConversationId: string | null,
): boolean {
  return (
    !!runConversationId &&
    runConversationId === activeConversationId &&
    runConversationId === currentRunConversationId
  );
}

export function isGeneratorConstructionCurrent(
  expectedEpoch: number,
  currentEpoch: number,
  conversationId: string | null,
  activeConversationId: string | null,
  currentRunConversationId: string | null,
  configMatches: boolean,
): boolean {
  return (
    expectedEpoch === currentEpoch &&
    configMatches &&
    isGenerationRunCurrent(
      conversationId,
      activeConversationId,
      currentRunConversationId,
    )
  );
}

export interface PendingToolCallLocation {
  messageIndex: number;
  toolCallIndex: number;
}

export function findPendingToolCall(
  messages: readonly Message[],
  preferredToolCallId?: string,
): PendingToolCallLocation | null {
  if (preferredToolCallId) {
    let laterResultCount = 0;
    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex--
    ) {
      const message = messages[messageIndex];
      if (
        message.role === "tool" &&
        message.tool_call_id === preferredToolCallId
      ) {
        laterResultCount += 1;
        continue;
      }
      const toolCalls = message.tool_calls;
      const toolCallIndex =
        toolCalls?.findIndex((call) => call.id === preferredToolCallId) ?? -1;
      if (toolCallIndex !== -1) {
        return laterResultCount > 0 ? null : { messageIndex, toolCallIndex };
      }
    }

    return null;
  }

  const laterResultCounts = new Map<string, number>();
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = messages[messageIndex];
    if (message.role === "tool" && message.tool_call_id) {
      laterResultCounts.set(
        message.tool_call_id,
        (laterResultCounts.get(message.tool_call_id) ?? 0) + 1,
      );
      continue;
    }

    const toolCalls = message.tool_calls;
    if (!toolCalls?.length) continue;
    for (
      let toolCallIndex = toolCalls.length - 1;
      toolCallIndex >= 0;
      toolCallIndex--
    ) {
      const id = toolCalls[toolCallIndex].id;
      const completedCount = laterResultCounts.get(id) ?? 0;
      if (completedCount > 0) {
        if (completedCount === 1) laterResultCounts.delete(id);
        else laterResultCounts.set(id, completedCount - 1);
        continue;
      }
      return { messageIndex, toolCallIndex };
    }
  }
  return null;
}
