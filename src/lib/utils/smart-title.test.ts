import { describe, expect, it, vi } from "vitest";
import type { Message } from "../../types";
import {
  deriveFallbackTitle,
  generateSmartTitle,
  normalizeSmartTitle,
} from "./smart-title";

const config = {
  apiType: "openai" as const,
  apiBaseUrl: "https://api.openai.com",
  apiKey: "test-key",
  model: "test-model",
};

const conversation: Message[] = [
  { role: "user", content: "Improve the session list" },
  { role: "assistant", content: "Implemented." },
];

describe("normalizeSmartTitle", () => {
  it("takes the first non-empty line and removes presentation formatting", () => {
    expect(
      normalizeSmartTitle('\n# "Session list improvements。"\nDetails'),
    ).toBe("Session list improvements");
    expect(normalizeSmartTitle('"# Wrapped heading title!"')).toBe(
      "Wrapped heading title",
    );
  });

  it("rejects titles longer than the model-title limit", () => {
    expect(normalizeSmartTitle("x".repeat(81))).toBeNull();
  });
});

describe("deriveFallbackTitle", () => {
  it("cleans and truncates the first non-QA user request", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "Automatic QA",
        metadata: { origin: "auto_qa" },
      },
      {
        role: "user",
        content: `# **Build** [the session list](https://example.com) ${"carefully ".repeat(10)}`,
      },
    ];

    const title = deriveFallbackTitle(messages);
    expect(title).toBeTruthy();
    expect(Array.from(title ?? "")).toHaveLength(60);
    expect(title).toMatch(/^Build the session list carefully/u);
  });

  it("uses the first attachment name for an attachment-only request", () => {
    expect(
      deriveFallbackTitle([
        {
          role: "user",
          content: "",
          metadata: {
            attachments: [
              {
                id: "attachment-1",
                type: "image",
                name: "settings-reference.png",
                mimeType: "image/png",
                size: 123,
              },
            ],
          },
        },
      ]),
    ).toBe("settings-reference.png");
  });
});

describe("generateSmartTitle", () => {
  it("normalizes a valid model title", async () => {
    await expect(
      generateSmartTitle(
        conversation,
        config,
        vi.fn(async () => '\n## "Session list improvements!"\n'),
      ),
    ).resolves.toBe("Session list improvements");
  });

  it("falls back deterministically when the model fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      generateSmartTitle(
        conversation,
        config,
        vi.fn(async () => {
          throw new Error("offline");
        }),
      ),
    ).resolves.toBe("Improve the session list");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("deterministic fallback"),
      expect.any(Error),
    );

    warn.mockRestore();
  });

  it("falls back when the model returns an invalid title", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      generateSmartTitle(
        conversation,
        config,
        vi.fn(async () => "x".repeat(81)),
      ),
    ).resolves.toBe("Improve the session list");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("empty or invalid title"),
    );

    warn.mockRestore();
  });
});
