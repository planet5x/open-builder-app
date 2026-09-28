import { describe, expect, it } from "vitest";
import {
  classifyGenerationError,
  formatGenerationErrorMessage,
} from "./generation-error";
import { en } from "../../i18n/en";

describe("generation error helpers", () => {
  it("classifies common recoverable and non-recoverable errors", () => {
    expect(classifyGenerationError({ status: 401, message: "nope" })).toMatchObject({
      kind: "auth",
      retryable: false,
    });
    expect(classifyGenerationError(new Error("context_length_exceeded"))).toMatchObject({
      kind: "context_length",
      retryable: true,
    });
    expect(classifyGenerationError(new Error("failed to fetch"))).toMatchObject({
      kind: "network",
      retryable: true,
    });
    expect(
      classifyGenerationError(new Error("Automatic QA failed: bad build")),
    ).toMatchObject({
      kind: "runtime_check",
      retryable: true,
    });
  });

  it("formats user-facing recovery guidance", () => {
    const message = formatGenerationErrorMessage(
      {
        kind: "model",
        message: "rate limited",
        status: 429,
        retryable: true,
      },
      en,
    );

    expect(message).toContain("Model service error");
    expect(message).toContain("HTTP status: 429");
    expect(message).toContain("You can retry");
    expect(message).toContain("`rate limited`");
  });
});
