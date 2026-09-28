import { describe, expect, it } from "vitest";
import {
  TOOL_ERROR_MAX_CHARS,
  TOOL_QUERY_MAX_CHARS,
  TOOL_URL_MAX_CHARS,
  clampInt,
  formatHttpError,
  limitArray,
  limitRecord,
  mapWithConcurrency,
  normalizeHttpUrl,
  normalizeHttpUrlList,
  normalizeToolQuery,
  readResponseTextWithLimit,
  safeErrorMessage,
  truncateText,
} from "./network-guard";

describe("network guard helpers", () => {
  it("clamps numeric tool arguments", () => {
    expect(clampInt(undefined, 5, 1, 10)).toBe(5);
    expect(clampInt("20", 5, 1, 10)).toBe(10);
    expect(clampInt(-1, 5, 1, 10)).toBe(1);
    expect(clampInt(3.8, 5, 1, 10)).toBe(3);
  });

  it("limits arrays and reports truncation", () => {
    const limited = limitArray([1, 2, 3], 2);

    expect(limited.items).toEqual([1, 2]);
    expect(limited.truncated).toBe(true);
    expect(limited.originalCount).toBe(3);
  });

  it("limits records and preserves entry order", () => {
    const limited = limitRecord({ a: 1, b: 2, c: 3 }, 2);

    expect(limited.value).toEqual({ a: 1, b: 2 });
    expect(limited.truncated).toBe(true);
    expect(limited.originalCount).toBe(3);
  });

  it("truncates text and reports original length", () => {
    const result = truncateText("abcdef", 3);

    expect(result.text).toBe("abc");
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(6);
  });

  it("normalizes bounded search queries", () => {
    expect(normalizeToolQuery("  react table  ")).toEqual({
      ok: true,
      query: "react table",
    });
    expect(normalizeToolQuery("")).toEqual({
      ok: false,
      error: "query must not be empty",
    });
    expect(normalizeToolQuery("x".repeat(TOOL_QUERY_MAX_CHARS + 1))).toEqual({
      ok: false,
      error: `query is too long (max ${TOOL_QUERY_MAX_CHARS} characters)`,
    });
  });

  it("normalizes only http(s) URLs and caps URL batches", () => {
    expect(normalizeHttpUrl("https://example.com/a#fragment")).toEqual({
      ok: true,
      url: "https://example.com/a",
    });
    expect(normalizeHttpUrl("file:///etc/passwd")).toEqual({
      ok: false,
      error: "url must use http(s)",
    });
    expect(
      normalizeHttpUrl(`https://example.com/${"x".repeat(TOOL_URL_MAX_CHARS)}`),
    ).toEqual({
      ok: false,
      error: `url is too long (max ${TOOL_URL_MAX_CHARS} characters)`,
    });

    const list = normalizeHttpUrlList(["https://a.test", "https://b.test"], 1);
    expect(list).toEqual({
      ok: true,
      urls: ["https://a.test/"],
      truncated: true,
    });
  });

  it("truncates tool error messages and HTTP error bodies", () => {
    const message = safeErrorMessage(
      new Error("x".repeat(TOOL_ERROR_MAX_CHARS + 20)),
    );
    expect(message).toHaveLength(TOOL_ERROR_MAX_CHARS + " [truncated]".length);
    expect(message.endsWith("[truncated]")).toBe(true);

    expect(
      formatHttpError(
        "Search failed",
        500,
        "x".repeat(TOOL_ERROR_MAX_CHARS + 1),
      ),
    ).toContain("[truncated]");
  });

  it("maps with bounded concurrency while preserving order", async () => {
    let active = 0;
    let maxActive = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return value * 2;
    });

    expect(result).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("cancels chunked responses before allocating beyond the byte limit", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
          controller.enqueue(new Uint8Array(4));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expect(
      readResponseTextWithLimit(response, 5, "Registry response"),
    ).rejects.toThrow("exceeds");
    expect(cancelled).toBe(true);
  });
});
