import { MCP_LIMITS } from "./limits";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

function stableHash(value: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(36).padStart(13, "0").slice(-12);
}

function toolSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "") || "tool"
  );
}

/**
 * Creates a deterministic provider-safe alias without exposing the original
 * server/tool names as an execution contract. The suffix hashes the full names,
 * so truncation and non-ASCII slug collisions remain distinct.
 */
export function createMcpToolAlias(
  serverId: string,
  toolName: string,
  maxLength = MCP_LIMITS.maxToolAliasChars,
): string {
  const prefix = "mcp_";
  const hash = stableHash(`${serverId}\0${toolName}`);
  const fixedLength = prefix.length + hash.length + 2;
  if (maxLength < fixedLength + 2) {
    throw new Error(
      `MCP tool alias limit must be at least ${fixedLength + 2}.`,
    );
  }
  const slugBudget = maxLength - fixedLength;
  const serverBudget = Math.max(1, Math.floor(slugBudget * 0.45));
  const toolBudget = Math.max(1, slugBudget - serverBudget);
  const server = toolSlug(serverId).slice(0, serverBudget);
  const tool = toolSlug(toolName).slice(0, toolBudget);
  return `${prefix}${server}_${tool}_${hash}`;
}

export interface McpToolAliasTarget {
  serverId: string;
  toolName: string;
}

export function buildMcpToolAliasMap(
  targets: readonly McpToolAliasTarget[],
): Record<string, McpToolAliasTarget> {
  const aliases: Record<string, McpToolAliasTarget> = {};
  for (const target of targets) {
    const alias = createMcpToolAlias(target.serverId, target.toolName);
    const existing = aliases[alias];
    if (
      existing &&
      (existing.serverId !== target.serverId ||
        existing.toolName !== target.toolName)
    ) {
      throw new Error("MCP tool alias collision detected.");
    }
    aliases[alias] = target;
  }
  return aliases;
}
