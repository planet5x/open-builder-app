import { tool } from "ai";
import { z } from "zod";
import type { MemoryItem, MemoryOperation } from "../../types";
import {
  limitMemoriesForPrompt,
  sanitizeMemoryOperations,
} from "../utils/memory-limits";

export interface MemoryDeps {
  getAll: () => MemoryItem[];
  processBatch: (operations: MemoryOperation[]) => string;
}

// ═══════════════════════════════ Constants ═══════════════════════════════════

export const MEMORY_TOOL_NAME = "manage_memories";

// ═══════════════════════════════ Tool Definition ═════════════════════════════

export const MEMORY_TOOLS = {
  [MEMORY_TOOL_NAME]: tool({
    description:
      "Save, update, or delete user memories. Call this when you discover important " +
      "information about the user during conversation, such as their preferences, " +
      "personal details, instructions for your behavior, or long-term relevant facts. " +
      "Supports batch operations: you can add new memories, update existing ones " +
      "(to resolve conflicts or refine), and delete outdated ones in a single call. " +
      "Do NOT save temporary or one-off information. " +
      "Do NOT inform the user that you are saving memories — do it silently.",
    inputSchema: z.object({
      operations: z
        .array(
          z.object({
            action: z
              .enum(["add", "update", "delete"])
              .describe("The operation type"),
            id: z
              .string()
              .optional()
              .describe(
                "Memory ID (required for update and delete operations)",
              ),
            content: z
              .string()
              .optional()
              .describe(
                "Memory content in third person (e.g., 'The user is a frontend developer'). " +
                  "Required for add and update.",
              ),
            category: z
              .enum([
                "preference",
                "personal_info",
                "instruction",
                "fact",
                "project",
              ])
              .optional()
              .describe("Memory category. Required for add."),
          }),
        )
        .describe("List of memory operations to perform"),
    }),
  }),
};

// ═══════════════════════════════ Tool Handler ════════════════════════════════

/** Create the memory tool handler function */
export function createMemoryToolHandler(deps: MemoryDeps): (
  name: string,
  args: unknown,
) => string {
  return (name: string, args: unknown): string => {
    if (name !== MEMORY_TOOL_NAME) {
      return `Error: unknown tool "${name}"`;
    }
    const { operations } = (args ?? {}) as { operations?: unknown };
    const checked = sanitizeMemoryOperations(
      operations,
      deps.getAll().length,
    );
    if (!checked.ok) {
      return `Error: ${checked.error}`;
    }
    console.group(
      `[Memory] manage_memories called with ${checked.operations.length} operation(s)`,
    );
    for (const op of checked.operations) {
      console.log(
        `  [${op.action}]`,
        op.id ? `id=${op.id}` : "",
        op.content ?? "",
        op.category ? `(${op.category})` : "",
      );
    }
    const result = deps.processBatch(checked.operations);
    console.log(`  Result: ${result}`);
    console.log("  Current memories:", deps.getAll());
    console.groupEnd();
    return result;
  };
}

// ═══════════════════════════════ Prompt Builder ══════════════════════════════

/** Build the memory instruction + existing memories block for the system prompt */
export function buildMemoryPromptSection(memories: MemoryItem[]): string {
  const promptMemories = limitMemoriesForPrompt(memories);
  const memoryCount = promptMemories.length;

  let section = `\n\n<memory>
## Long-term Memory

Silently call \`manage_memories\` when the conversation reveals something worth carrying into future sessions:

- Who the user is — role, location, other stable personal facts
- Stated preferences and habits — frameworks, coding style, language
- How the user wants you to behave
- Durable project facts — ongoing work, tech-stack decisions

Guidelines:
- Answer the user normally; saving is a background action. Never mention that you are doing it.
- New information that contradicts an old memory UPDATES it — never store a duplicate.
- DELETE memories once they are outdated or irrelevant, to free space.
- Batch add, update, and delete operations into one call.
- Skip anything temporary or one-off.`;

  // Adaptive trigger frequency based on memory count
  if (memoryCount === 0) {
    section += `

**Cold start:** You have no memories about this user yet. On your first response, save whatever durable facts they have already revealed — role, project type, tech stack, language preference. Small details count at this stage.`;
  } else if (memoryCount <= 3) {
    section += `

**Note:** You have very few memories so far. Watch actively for the user's preferences, habits, and project context, and save what you learn.`;
  } else {
    section += `

**Note:** Most turns need no saving. Call the tool only for genuinely new, valuable information.`;
  }

  // Timing guidance
  section += `

**Timing:** Call \`manage_memories\` at the START of a response, when you spot key information in the user's message, or at the END, after the main task is done. Never mid-chain — it interrupts the development workflow.`;

  if (memoryCount > 0) {
    section += `\n\n## Known information about the user\n`;
    for (const m of promptMemories) {
      section += `- [id: ${m.id}] [${m.category}] ${m.content}\n`;
    }
  }

  section += `\n</memory>`;
  return section;
}
