export type ApiType = "openai-compatible" | "openai" | "anthropic" | "google";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";

export function defaultModelForApiType(apiType: ApiType): string {
  return apiType === "openai" || apiType === "openai-compatible"
    ? DEFAULT_OPENAI_MODEL
    : "";
}

/** Default API base URLs without version suffixes. */
export const DEFAULT_BASE_URLS: Record<ApiType, string> = {
  "openai-compatible": "http://localhost:11434",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
};

const DEFAULT_VERSION_PATHS: Record<ApiType, string> = {
  "openai-compatible": "/v1",
  openai: "/v1",
  anthropic: "/v1",
  google: "/v1beta",
};

export const MODEL_LIST_LIMITS = {
  timeoutMs: 10_000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxModels: 200,
  maxModelIdChars: 160,
} as const;

export interface ProviderConfig {
  apiType: ApiType;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

function hasVersionPath(url: string): boolean {
  return /\/v\d+(\w*)$/.test(url);
}

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > MODEL_LIST_LIMITS.maxModelIdChars) return null;
  if (/[\u0000-\u001f\u007f]/.test(model)) return null;
  return model;
}

function finalizeModelIds(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const model = normalizeModelId(value);
    if (!model) continue;
    out.add(model);
    if (out.size >= MODEL_LIST_LIMITS.maxModels) break;
  }
  return Array.from(out).sort();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(
    () => controller.abort(),
    MODEL_LIST_LIMITS.timeoutMs,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function readJsonWithLimit(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (
      Number.isFinite(declared) &&
      declared > MODEL_LIST_LIMITS.maxResponseBytes
    ) {
      throw new Error("Model list response is too large.");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (
      new TextEncoder().encode(text).byteLength >
      MODEL_LIST_LIMITS.maxResponseBytes
    ) {
      throw new Error("Model list response is too large.");
    }
    return JSON.parse(text);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MODEL_LIST_LIMITS.maxResponseBytes) {
      await reader.cancel();
      throw new Error("Model list response is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function resolveBaseURL(url: string, apiType: ApiType): string {
  const cleaned = url.replace(/\/+$/, "");
  if (hasVersionPath(cleaned)) return cleaned;
  return cleaned + DEFAULT_VERSION_PATHS[apiType];
}

export async function fetchModelList(
  apiType: ApiType,
  apiBaseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const baseURL = resolveBaseURL(apiBaseUrl, apiType);

  switch (apiType) {
    case "openai-compatible":
    case "openai": {
      const url = `${baseURL}/models`;
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await readJsonWithLimit(res)) as { data?: unknown[] };
      return finalizeModelIds((json.data ?? []).map((m: any) => m?.id));
    }

    case "anthropic": {
      const url = `${baseURL}/models`;
      const res = await fetchWithTimeout(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await readJsonWithLimit(res)) as { data?: unknown[] };
      return finalizeModelIds((json.data ?? []).map((m: any) => m?.id));
    }

    case "google": {
      const url = `${baseURL}/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetchWithTimeout(url, {});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await readJsonWithLimit(res)) as { models?: unknown[] };
      return finalizeModelIds(
        (json.models ?? []).map((m: any) =>
          typeof m?.name === "string" ? m.name.replace(/^models\//, "") : null,
        ),
      );
    }

    default:
      return [];
  }
}
