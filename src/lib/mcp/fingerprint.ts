import { MCP_LIMITS } from "./limits";
import type {
  JsonObject,
  McpDriftReport,
  McpServerDiscovery,
  McpServerEntry,
  McpToolApproval,
  McpToolDefinition,
} from "./types";
import {
  McpValidationError,
  sanitizeMcpToolPermissions,
  validateMcpToolDefinition,
} from "./validation";

function canonicalValue(
  value: unknown,
  stack: Set<object>,
): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "bigint":
      throw new TypeError("BigInt is not valid JSON.");
    case "object": {
      if (stack.has(value))
        throw new TypeError("Cannot fingerprint cyclic data.");
      stack.add(value);
      let result: string;
      if (Array.isArray(value)) {
        result = `[${value
          .map((item) => canonicalValue(item, stack) ?? "null")
          .join(",")}]`;
      } else {
        const parts: string[] = [];
        for (const key of Object.keys(value).sort()) {
          const child = canonicalValue(
            (value as Record<string, unknown>)[key],
            stack,
          );
          if (child !== undefined)
            parts.push(`${JSON.stringify(key)}:${child}`);
        }
        result = `{${parts.join(",")}}`;
      }
      stack.delete(value);
      return result;
    }
  }
}

export function canonicalMcpJson(value: unknown): string {
  return canonicalValue(value, new Set()) ?? "null";
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required to fingerprint MCP definitions.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function fingerprintableTool(tool: McpToolDefinition): JsonObject {
  return {
    name: tool.name,
    title: tool.title ?? null,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations
      ? {
          title: tool.annotations.title ?? null,
          readOnlyHint: tool.annotations.readOnlyHint ?? null,
          destructiveHint: tool.annotations.destructiveHint ?? null,
          idempotentHint: tool.annotations.idempotentHint ?? null,
          openWorldHint: tool.annotations.openWorldHint ?? null,
        }
      : null,
  };
}

export async function fingerprintMcpTool(
  tool: McpToolDefinition,
): Promise<string> {
  const validation = validateMcpToolDefinition(tool);
  if (!validation.valid) throw new McpValidationError(validation.errors);
  return sha256(canonicalMcpJson(fingerprintableTool(tool)));
}

export async function fingerprintMcpInstructions(
  instructions?: string,
): Promise<string> {
  const value = instructions ?? "";
  if (
    new TextEncoder().encode(value).byteLength > MCP_LIMITS.maxInstructionsBytes
  ) {
    throw new McpValidationError([
      {
        path: "instructions",
        code: "too_large",
        message: "Server instructions are too large.",
      },
    ]);
  }
  return sha256(value);
}

async function fingerprintDiscovery(discovery: McpServerDiscovery): Promise<{
  fingerprint: string;
  instructionsFingerprint: string;
  toolFingerprints: Map<string, string>;
}> {
  const toolFingerprints = new Map<string, string>();
  for (const tool of discovery.tools) {
    if (toolFingerprints.has(tool.name)) {
      throw new McpValidationError([
        {
          path: `tools.${tool.name}`,
          code: "duplicate_name",
          message: `Server returned duplicate tool name "${tool.name}".`,
        },
      ]);
    }
    toolFingerprints.set(tool.name, await fingerprintMcpTool(tool));
  }
  const instructionsFingerprint = await fingerprintMcpInstructions(
    discovery.instructions,
  );
  const fingerprint = await sha256(
    canonicalMcpJson({
      instructionsFingerprint,
      tools: Array.from(toolFingerprints.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, toolFingerprint]) => ({
          name,
          fingerprint: toolFingerprint,
        })),
    }),
  );
  return { fingerprint, instructionsFingerprint, toolFingerprints };
}

export async function fingerprintMcpDiscovery(
  discovery: McpServerDiscovery,
): Promise<string> {
  return (await fingerprintDiscovery(discovery)).fingerprint;
}

export async function compareMcpDiscovery(
  approved: McpServerEntry,
  current: McpServerDiscovery,
): Promise<McpDriftReport> {
  const fingerprints = await fingerprintDiscovery(current);
  const approvedNames = new Set(Object.keys(approved.tools));
  const currentNames = new Set(current.tools.map((tool) => tool.name));
  const added = [...currentNames]
    .filter((name) => !approvedNames.has(name))
    .sort();
  const removed = [...approvedNames]
    .filter((name) => !currentNames.has(name))
    .sort();
  const changed = current.tools
    .filter((tool) => {
      const prior = approved.tools[tool.name];
      return (
        prior !== undefined &&
        prior.fingerprint !== fingerprints.toolFingerprints.get(tool.name)
      );
    })
    .map((tool) => tool.name)
    .sort();
  const instructionsChanged =
    approved.instructionsFingerprint !== fingerprints.instructionsFingerprint;
  const unapproved = approved.approvedAt === undefined;
  const drifted =
    added.length > 0 ||
    removed.length > 0 ||
    changed.length > 0 ||
    instructionsChanged ||
    (approved.definitionFingerprint !== undefined &&
      approved.definitionFingerprint !== fingerprints.fingerprint);
  return {
    status: unapproved ? "unapproved" : drifted ? "drifted" : "clean",
    added,
    removed,
    changed,
    instructionsChanged,
    approvedFingerprint: approved.definitionFingerprint,
    currentFingerprint: fingerprints.fingerprint,
  };
}

export interface ApproveMcpDiscoveryOptions {
  now?: number;
  enableServer?: boolean;
  enableNewTools?: boolean;
}

export async function approveMcpDiscovery(
  entry: McpServerEntry,
  discovery: McpServerDiscovery,
  options: ApproveMcpDiscoveryOptions = {},
): Promise<McpServerEntry> {
  const fingerprints = await fingerprintDiscovery(discovery);
  const enableNewTools = options.enableNewTools ?? true;
  const tools: Record<string, McpToolApproval> = {};
  for (const definition of discovery.tools) {
    const fingerprint = fingerprints.toolFingerprints.get(definition.name);
    if (!fingerprint) throw new Error("MCP tool fingerprint is missing.");
    const previous = entry.tools[definition.name];
    const unchanged = previous?.fingerprint === fingerprint;
    tools[definition.name] = sanitizeMcpToolPermissions({
      ...definition,
      fingerprint,
      enabled: unchanged
        ? previous.enabled
        : (previous?.enabled ?? enableNewTools),
      allowInPlanMode: unchanged ? previous.allowInPlanMode : false,
      allowForSubagents: unchanged ? previous.allowForSubagents : false,
      elevatedPermissionsPolicyVersion: unchanged
        ? previous.elevatedPermissionsPolicyVersion
        : undefined,
    });
  }
  const now = options.now ?? Date.now();
  return {
    ...entry,
    enabled: options.enableServer ?? true,
    instructions: discovery.instructions,
    instructionsFingerprint: fingerprints.instructionsFingerprint,
    definitionFingerprint: fingerprints.fingerprint,
    tools,
    approvedAt: now,
    updatedAt: now,
  };
}
