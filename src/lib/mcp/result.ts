import { normalizeToolResultForModel } from "../utils/tool-result";
import { MCP_LIMITS } from "./limits";
import type {
  JsonValue,
  McpBinaryResultContent,
  McpCallToolResultLike,
  McpEmbeddedResourceResultContent,
  McpResourceLinkResultContent,
  McpTextResultContent,
  McpToolResultContent,
  McpToolResultSnapshot,
} from "./types";

export interface McpResultLimits {
  maxContentBlocks: number;
  maxTextBytes: number;
  maxStructuredBytes: number;
  maxAttachments: number;
  maxImageBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface NormalizeMcpToolResultOptions {
  serverId?: string;
  serverName?: string;
  toolName?: string;
  limits?: Partial<McpResultLimits>;
}

const DEFAULT_LIMITS: McpResultLimits = {
  maxContentBlocks: MCP_LIMITS.maxResultContentBlocks,
  maxTextBytes: MCP_LIMITS.maxResultTextBytes,
  maxStructuredBytes: MCP_LIMITS.maxStructuredResultBytes,
  maxAttachments: MCP_LIMITS.maxResultAttachments,
  maxImageBytes: MCP_LIMITS.maxResultImageBytes,
  maxFileBytes: MCP_LIMITS.maxResultFileBytes,
  maxTotalBytes: MCP_LIMITS.maxResultTotalBytes,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder()
    .decode(encoded.slice(0, Math.max(0, maxBytes)))
    .replace(/�$/, "");
}

function boundedString(value: unknown, maxChars = 4_096): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\0\r\n]/g, " ").trim();
  return clean ? clean.slice(0, maxChars) : undefined;
}

function normalizeMimeType(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/.test(
    normalized,
  )
    ? normalized
    : fallback;
}

function normalizeMediaMimeType(
  value: unknown,
  kind: "image" | "audio",
): string {
  const fallback = kind === "image" ? "image/png" : "audio/mpeg";
  const normalized = normalizeMimeType(value, fallback);
  return normalized.startsWith(`${kind}/`) ? normalized : fallback;
}

function normalizeBase64(raw: unknown): {
  data?: string;
  size: number;
  error?: string;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return { size: 0, error: "Missing base64 data." };
  }
  const comma = raw.indexOf(",");
  const value =
    raw.startsWith("data:") && comma >= 0 ? raw.slice(comma + 1) : raw;
  const data = value.replace(/\s/g, "");
  if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    return { size: 0, error: "Invalid base64 data." };
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return {
    data,
    size: Math.max(0, Math.floor((data.length * 3) / 4) - padding),
  };
}

function normalizeStructuredContent(value: unknown): {
  value?: JsonValue;
  bytes: number;
  error?: string;
} {
  if (value === undefined) return { bytes: 0 };
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return {
        bytes: 0,
        error: "Structured content is not JSON-serializable.",
      };
    }
    return {
      value: JSON.parse(serialized) as JsonValue,
      bytes: utf8Bytes(serialized),
    };
  } catch {
    return { bytes: 0, error: "Structured content is not JSON-serializable." };
  }
}

function fallbackLine(content: McpToolResultContent): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "image":
    case "audio":
      return `[MCP ${content.type}: ${content.mimeType}, ${content.size} bytes${
        content.omitted ? `, omitted: ${content.reason ?? "size limit"}` : ""
      }]`;
    case "resource": {
      const heading = `[MCP resource: ${content.uri}${
        content.mimeType ? `, ${content.mimeType}` : ""
      }${content.omitted ? `, omitted: ${content.reason ?? "size limit"}` : ""}]`;
      return content.text ? `${heading}\n${content.text}` : heading;
    }
    case "resource_link":
      return `[MCP resource link: ${content.name} <${content.uri}>; not fetched]`;
    case "unsupported":
      return `[Unsupported MCP content block "${content.originalType}": ${content.reason}]`;
  }
}

export function normalizeMcpToolResult(
  result: McpCallToolResultLike | unknown,
  options: NormalizeMcpToolResultOptions = {},
): McpToolResultSnapshot {
  const limits: McpResultLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const root = isRecord(result) ? result : {};
  const rawContent = Array.isArray(root.content) ? root.content : [];
  const content: McpToolResultContent[] = [];
  let attachmentCount = 0;
  let totalBytes = 0;
  let truncated = rawContent.length > limits.maxContentBlocks;

  for (const rawBlock of rawContent.slice(0, limits.maxContentBlocks)) {
    if (!isRecord(rawBlock) || typeof rawBlock.type !== "string") {
      content.push({
        type: "unsupported",
        originalType: "unknown",
        reason: "Content block is malformed.",
      });
      truncated = true;
      continue;
    }

    if (rawBlock.type === "text") {
      if (typeof rawBlock.text !== "string") {
        content.push({
          type: "unsupported",
          originalType: "text",
          reason: "Text block is malformed.",
        });
        truncated = true;
        continue;
      }
      const available = Math.max(0, limits.maxTotalBytes - totalBytes);
      const allowed = Math.min(limits.maxTextBytes, available);
      const originalBytes = utf8Bytes(rawBlock.text);
      const text = truncateUtf8(rawBlock.text, allowed);
      const wasTruncated = originalBytes > allowed;
      const normalized: McpTextResultContent = {
        type: "text",
        text: wasTruncated
          ? `${text}\n[content truncated after ${allowed} bytes]`
          : text,
        ...(wasTruncated ? { truncated: true } : {}),
      };
      content.push(normalized);
      totalBytes += Math.min(originalBytes, allowed);
      truncated ||= wasTruncated;
      continue;
    }

    if (rawBlock.type === "image" || rawBlock.type === "audio") {
      const binary = normalizeBase64(rawBlock.data);
      const mimeType = normalizeMediaMimeType(rawBlock.mimeType, rawBlock.type);
      const itemLimit =
        rawBlock.type === "image" ? limits.maxImageBytes : limits.maxFileBytes;
      let reason = binary.error;
      if (!reason && attachmentCount >= limits.maxAttachments) {
        reason = `attachment count exceeds ${limits.maxAttachments}`;
      }
      if (!reason && binary.size > itemLimit) {
        reason = `content exceeds ${itemLimit} bytes`;
      }
      if (!reason && totalBytes + binary.size > limits.maxTotalBytes) {
        reason = `total content exceeds ${limits.maxTotalBytes} bytes`;
      }
      const normalized: McpBinaryResultContent = {
        type: rawBlock.type,
        mimeType,
        size: binary.size,
        ...(!reason && binary.data ? { data: binary.data } : {}),
        ...(reason ? { omitted: true, reason } : {}),
      };
      content.push(normalized);
      if (reason) {
        truncated = true;
      } else {
        attachmentCount += 1;
        totalBytes += binary.size;
      }
      continue;
    }

    if (rawBlock.type === "resource") {
      const rawResource = isRecord(rawBlock.resource) ? rawBlock.resource : {};
      const uri = boundedString(rawResource.uri) ?? "unknown:";
      const text =
        typeof rawResource.text === "string" ? rawResource.text : undefined;
      const binary =
        text === undefined ? normalizeBase64(rawResource.blob) : undefined;
      const originalBytes =
        text === undefined ? (binary?.size ?? 0) : utf8Bytes(text);
      let reason = text === undefined ? binary?.error : undefined;
      if (!reason && attachmentCount >= limits.maxAttachments) {
        reason = `attachment count exceeds ${limits.maxAttachments}`;
      }
      if (!reason && originalBytes > limits.maxFileBytes) {
        reason = `resource exceeds ${limits.maxFileBytes} bytes`;
      }
      if (!reason && totalBytes + originalBytes > limits.maxTotalBytes) {
        reason = `total content exceeds ${limits.maxTotalBytes} bytes`;
      }
      const normalized: McpEmbeddedResourceResultContent = {
        type: "resource",
        uri,
        name: boundedString(rawResource.name),
        title: boundedString(rawResource.title),
        mimeType:
          rawResource.mimeType === undefined
            ? undefined
            : normalizeMimeType(
                rawResource.mimeType,
                "application/octet-stream",
              ),
        size: originalBytes,
        ...(!reason && text !== undefined ? { text } : {}),
        ...(!reason && text === undefined && binary?.data
          ? { blob: binary.data }
          : {}),
        ...(reason ? { omitted: true, reason } : {}),
      };
      content.push(normalized);
      if (reason) {
        truncated = true;
      } else {
        attachmentCount += 1;
        totalBytes += originalBytes;
      }
      continue;
    }

    if (
      rawBlock.type === "resource_link" ||
      rawBlock.type === "resource-link"
    ) {
      const uri = boundedString(rawBlock.uri) ?? "unknown:";
      const normalized: McpResourceLinkResultContent = {
        type: "resource_link",
        uri,
        name: boundedString(rawBlock.name) ?? uri,
        title: boundedString(rawBlock.title),
        description:
          typeof rawBlock.description === "string"
            ? truncateUtf8(rawBlock.description, 16 * 1024)
            : undefined,
        mimeType:
          rawBlock.mimeType === undefined
            ? undefined
            : normalizeMimeType(rawBlock.mimeType, "application/octet-stream"),
        size:
          typeof rawBlock.size === "number" &&
          Number.isSafeInteger(rawBlock.size) &&
          rawBlock.size >= 0
            ? rawBlock.size
            : undefined,
      };
      content.push(normalized);
      continue;
    }

    content.push({
      type: "unsupported",
      originalType: rawBlock.type.slice(0, 128),
      reason: "This MCP content type is not supported.",
    });
    truncated = true;
  }

  const structured = normalizeStructuredContent(root.structuredContent);
  let structuredContent: JsonValue | undefined;
  let structuredContentOmitted = false;
  if (structured.value !== undefined) {
    if (
      structured.bytes > limits.maxStructuredBytes ||
      totalBytes + structured.bytes > limits.maxTotalBytes
    ) {
      structuredContentOmitted = true;
      truncated = true;
    } else {
      structuredContent = structured.value;
    }
  } else if (structured.error) {
    structuredContentOmitted = true;
    truncated = true;
  }

  const fallbackParts = content.map(fallbackLine);
  if (structuredContent !== undefined) {
    fallbackParts.push(
      `[MCP structured content]\n${JSON.stringify(structuredContent, null, 2)}`,
    );
  } else if (structuredContentOmitted) {
    fallbackParts.push(
      "[MCP structured content omitted: invalid or over size limit]",
    );
  }
  if (rawContent.length > limits.maxContentBlocks) {
    fallbackParts.push(
      `[${rawContent.length - limits.maxContentBlocks} MCP content blocks omitted]`,
    );
  }
  const rawFallback =
    fallbackParts.join("\n\n") || "(MCP tool returned no content)";
  const model = normalizeToolResultForModel(rawFallback);
  truncated ||= model.truncated;

  return {
    serverId: options.serverId,
    serverName: options.serverName,
    toolName: options.toolName,
    isError: root.isError === true,
    content,
    structuredContent,
    ...(structuredContentOmitted ? { structuredContentOmitted: true } : {}),
    modelText: model.result,
    truncated,
  };
}
