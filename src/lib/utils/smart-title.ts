import { generateText } from "ai";
import type { Message } from "../ai/generator";
import type { ProviderConfig } from "../ai/provider";
import { getProviderModel } from "../ai/provider";

const MAX_MODEL_TITLE_LENGTH = 80;
const MAX_FALLBACK_TITLE_LENGTH = 60;

function firstTextContent(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function stripWrappingQuotes(value: string): string {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["`", "`"],
  ];
  let result = value.trim();
  for (const [start, end] of pairs) {
    if (result.startsWith(start) && result.endsWith(end)) {
      result = result.slice(start.length, -end.length).trim();
      break;
    }
  }
  return result;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[\s.!?。！？,:：;；，…]+$/u, "").trim();
}

function truncateCharacters(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("").trimEnd();
}

export function normalizeSmartTitle(value: string): string | null {
  const firstLine = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  let normalized = firstLine.replace(/\s+/gu, " ").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const cleaned = stripTrailingPunctuation(
      stripWrappingQuotes(normalized.replace(/^#{1,6}\s*/u, "").trim()),
    );
    if (cleaned === normalized) break;
    normalized = cleaned;
  }
  if (!normalized || Array.from(normalized).length > MAX_MODEL_TITLE_LENGTH) {
    return null;
  }
  return normalized;
}

function cleanFallbackText(value: string): string {
  return stripTrailingPunctuation(
    value
      .replace(/```[^\n]*\n?/gu, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/^(?:\s{0,3}(?:#{1,6}|>|[-*+]\s|\d+[.)]\s))+/gmu, "")
      .replace(/[*_~`]+/gu, "")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  );
}

function firstAttachmentName(message: Message): string {
  const storedName = message.metadata?.attachments?.[0]?.name?.trim();
  if (storedName) return storedName;
  if (!Array.isArray(message.content)) return "";
  const file = message.content.find((part) => part.type === "file");
  return file?.type === "file" ? file.file.filename.trim() : "";
}

export function deriveFallbackTitle(
  messages: readonly Message[],
): string | null {
  const firstRequest = messages.find(
    (message) =>
      message.role === "user" && message.metadata?.origin !== "auto_qa",
  );
  if (!firstRequest) return null;

  const text = cleanFallbackText(firstTextContent(firstRequest));
  const fallback = text || firstAttachmentName(firstRequest);
  if (!fallback) return null;
  return truncateCharacters(fallback, MAX_FALLBACK_TITLE_LENGTH);
}

export async function generateSmartTitle(
  messages: Message[],
  cfg: ProviderConfig,
  generateTextOverride?: (
    instructions: string,
    prompt: string,
  ) => Promise<string>,
): Promise<string | null> {
  const hasUser = messages.some(
    (m) => m.role === "user" && m.metadata?.origin !== "auto_qa",
  );
  const hasAssistant = messages.some((m) => m.role === "assistant");
  if (!hasUser || !hasAssistant) return null;

  const relevant = messages
    .filter(
      (m) =>
        m.role === "assistant" ||
        (m.role === "user" && m.metadata?.origin !== "auto_qa"),
    )
    .slice(0, 6)
    .map((m) => {
      const text = firstTextContent(m) || firstAttachmentName(m);
      return `${m.role}: ${text.slice(0, 200)}`;
    })
    .join("\n");

  const fallback = deriveFallbackTitle(messages);

  try {
    const instructions =
      "Title this development conversation in 4-12 words, naming the app or task being built. " +
      "Write it in the language the user is using. " +
      "Output the title alone — no quotes, no explanation, no trailing punctuation.";
    const title = generateTextOverride
      ? await generateTextOverride(instructions, relevant)
      : (
          await generateText({
            model: getProviderModel(cfg),
            instructions,
            prompt: relevant,
          })
        ).text || "";

    const normalized = normalizeSmartTitle(title);
    if (normalized) return normalized;
    console.warn(
      "[smart-title] Model returned an empty or invalid title; using the deterministic fallback.",
    );
    return fallback;
  } catch (error) {
    console.warn(
      "[smart-title] Title generation failed; using the deterministic fallback.",
      error,
    );
    return fallback;
  }
}
