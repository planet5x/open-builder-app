import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultModelForApiType,
  DEFAULT_OPENAI_MODEL,
  fetchModelList,
  MODEL_LIST_LIMITS,
  resolveBaseURL,
} from "./provider-config";

describe("provider config helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends provider version paths only when needed", () => {
    expect(resolveBaseURL("https://api.example.com", "openai")).toBe(
      "https://api.example.com/v1",
    );
    expect(resolveBaseURL("https://api.example.com/v1", "openai")).toBe(
      "https://api.example.com/v1",
    );
  });

  it("defaults only OpenAI-family API providers to the unified model", () => {
    expect(defaultModelForApiType("openai")).toBe(DEFAULT_OPENAI_MODEL);
    expect(defaultModelForApiType("openai-compatible")).toBe(
      DEFAULT_OPENAI_MODEL,
    );
    expect(defaultModelForApiType("anthropic")).toBe("");
    expect(defaultModelForApiType("google")).toBe("");
  });

  it("bounds and deduplicates OpenAI-compatible model ids", async () => {
    const data = Array.from(
      { length: MODEL_LIST_LIMITS.maxModels + 20 },
      (_, i) => ({ id: `model-${i}` }),
    );
    data.push({ id: "model-1" });
    data.push({ id: "x".repeat(MODEL_LIST_LIMITS.maxModelIdChars + 1) });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data,
        }),
      ),
    );

    const models = await fetchModelList(
      "openai-compatible",
      "https://api.example.com",
      "key",
    );

    expect(models).toHaveLength(MODEL_LIST_LIMITS.maxModels);
    expect(new Set(models).size).toBe(models.length);
    expect(models).not.toContain(
      "x".repeat(MODEL_LIST_LIMITS.maxModelIdChars + 1),
    );
  });

  it("normalizes Google model names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          models: [{ name: "models/gemini-pro" }, { name: "gemini-flash" }],
        }),
      ),
    );

    await expect(
      fetchModelList(
        "google",
        "https://generativelanguage.googleapis.com",
        "key",
      ),
    ).resolves.toEqual(["gemini-flash", "gemini-pro"]);
  });

  it("rejects oversized model list responses by content length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: {
              "content-length": String(MODEL_LIST_LIMITS.maxResponseBytes + 1),
            },
          }),
      ),
    );

    await expect(
      fetchModelList("openai", "https://api.example.com", "key"),
    ).rejects.toThrow(/too large/i);
  });
});
