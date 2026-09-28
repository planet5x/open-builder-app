import type { Message } from "../ai/generator";

const MEMORY_TOOL_NAME = "manage_memories";

/**
 * Drop memory-related messages (manage_memories tool calls and their results)
 * from the persisted history so users never see them in the UI.
 */
export function filterMemoryMessages(messages: Message[]): Message[] {
  const memoryToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === MEMORY_TOOL_NAME) {
          memoryToolCallIds.add(tc.id);
        }
      }
    }
  }

  if (memoryToolCallIds.size === 0) return messages;

  const result: Message[] = [];
  for (const msg of messages) {
    if (
      msg.role === "tool" &&
      msg.tool_call_id &&
      memoryToolCallIds.has(msg.tool_call_id)
    ) {
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls) {
      const nonMemoryToolCalls = msg.tool_calls.filter(
        (tc) => tc.function.name !== MEMORY_TOOL_NAME,
      );

      if (nonMemoryToolCalls.length === 0) {
        if (msg.content) {
          result.push({ ...msg, tool_calls: undefined });
        }
        continue;
      }

      result.push({ ...msg, tool_calls: nonMemoryToolCalls });
      continue;
    }

    result.push(msg);
  }

  return result;
}
