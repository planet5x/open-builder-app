import type { MemoryItem, MemoryOperation } from "../../types";

export const MEMORY_LIMITS = {
  maxItems: 100,
  maxOperations: 20,
  maxContentChars: 1_000,
  maxIdChars: 100,
} as const;

const MEMORY_CATEGORIES = new Set<MemoryItem["category"]>([
  "preference",
  "personal_info",
  "instruction",
  "fact",
  "project",
]);

export function sanitizeMemoryOperations(
  operations: unknown,
  existingCount: number,
): { ok: true; operations: MemoryOperation[] } | { ok: false; error: string } {
  if (!Array.isArray(operations) || operations.length === 0) {
    return {
      ok: false,
      error: "operations array is required and must not be empty",
    };
  }
  if (operations.length > MEMORY_LIMITS.maxOperations) {
    return {
      ok: false,
      error: `too many memory operations (max ${MEMORY_LIMITS.maxOperations})`,
    };
  }

  const sanitized: MemoryOperation[] = [];
  let addCount = 0;

  for (let i = 0; i < operations.length; i++) {
    const raw = operations[i] as Partial<MemoryOperation> | null;
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `operation #${i + 1} must be an object` };
    }
    if (
      raw.action !== "add" &&
      raw.action !== "update" &&
      raw.action !== "delete"
    ) {
      return { ok: false, error: `operation #${i + 1} has invalid action` };
    }

    const op: MemoryOperation = { action: raw.action };
    if (raw.id !== undefined) {
      if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
        return { ok: false, error: `operation #${i + 1} id must be a string` };
      }
      const id = raw.id.trim();
      if (id.length > MEMORY_LIMITS.maxIdChars) {
        return {
          ok: false,
          error: `operation #${i + 1} id is too long (max ${MEMORY_LIMITS.maxIdChars} characters)`,
        };
      }
      op.id = id;
    }

    if (raw.action === "add" || raw.action === "update") {
      if (typeof raw.content !== "string" || raw.content.trim().length === 0) {
        return {
          ok: false,
          error: `operation #${i + 1} content is required`,
        };
      }
      const content = raw.content.trim();
      if (content.length > MEMORY_LIMITS.maxContentChars) {
        return {
          ok: false,
          error: `operation #${i + 1} content is too long (max ${MEMORY_LIMITS.maxContentChars} characters)`,
        };
      }
      op.content = content;
    }

    if (raw.category !== undefined) {
      if (!MEMORY_CATEGORIES.has(raw.category)) {
        return {
          ok: false,
          error: `operation #${i + 1} category is invalid`,
        };
      }
      op.category = raw.category;
    }

    if (raw.action === "add") {
      if (!op.category) {
        return { ok: false, error: `operation #${i + 1} category is required` };
      }
      addCount++;
    } else if (!op.id) {
      return { ok: false, error: `operation #${i + 1} id is required` };
    }

    sanitized.push(op);
  }

  if (existingCount + addCount > MEMORY_LIMITS.maxItems) {
    return {
      ok: false,
      error: `too many memories (max ${MEMORY_LIMITS.maxItems})`,
    };
  }

  return { ok: true, operations: sanitized };
}

export function limitMemoriesForPrompt(memories: MemoryItem[]): MemoryItem[] {
  return memories.slice(0, MEMORY_LIMITS.maxItems).map((memory) => ({
    ...memory,
    content:
      memory.content.length > MEMORY_LIMITS.maxContentChars
        ? memory.content.slice(0, MEMORY_LIMITS.maxContentChars)
        : memory.content,
  }));
}
