import type { AskUserAnswers } from "../../types/api";
import type { ToolExecutionOutput } from "../ai/generator-types";

export const ASK_USER_ANSWERS_KIND = "ask_user_answers_v1" as const;

export interface AskUserAnswersStructuredContent {
  kind: typeof ASK_USER_ANSWERS_KIND;
  selections: string[][];
}

export interface AskUserAnswerSummaryItem {
  header: string;
  selections: string[];
}

export const TOOL_RESULT_LIMITS = {
  maxModelResultChars: 160_000,
} as const;

export function normalizeToolResultForModel(result: string): {
  result: string;
  truncated: boolean;
} {
  if (result.length <= TOOL_RESULT_LIMITS.maxModelResultChars) {
    return { result, truncated: false };
  }
  return {
    result:
      result.slice(0, TOOL_RESULT_LIMITS.maxModelResultChars) +
      `\n\n[tool result truncated after ${TOOL_RESULT_LIMITS.maxModelResultChars} chars]`,
    truncated: true,
  };
}

/** Preserve rich custom-tool data while keeping the legacy text contract
 * bounded and deterministic. */
export function normalizeToolExecutionOutput(
  value: string | ToolExecutionOutput,
): ToolExecutionOutput {
  const output = typeof value === "string" ? { text: value } : value;
  const normalized = normalizeToolResultForModel(output.text);
  return {
    ...output,
    text: normalized.result,
    modelOutput:
      output.modelOutput ??
      (output.isError
        ? { type: "error-text", value: normalized.result }
        : { type: "text", value: normalized.result }),
  };
}

export async function toolResult<T>(
  promise: Promise<T>,
  shape: (value: T) => Record<string, unknown>,
): Promise<string> {
  try {
    return JSON.stringify({ ok: true, ...shape(await promise) });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Format the answers from `ask_user_question` into a human-readable string
 *  that the model can consume as the tool result. */
export function formatAskUserAnswers(answers: AskUserAnswers): string {
  if (!answers.answers?.length) {
    return "(no answers returned)";
  }
  return answers.answers
    .map((a, idx) => {
      const picks = a.selected.length
        ? a.selected.join(" | ")
        : "(no selection)";
      return `Q${idx + 1} [${a.header}] ${a.question}\n→ ${picks}`;
    })
    .join("\n\n");
}

/** Build a model-compatible text result plus a selection-only UI payload. */
export function createAskUserAnswersToolOutput(
  answers: AskUserAnswers,
): ToolExecutionOutput {
  return {
    text: formatAskUserAnswers(answers),
    structuredContent: {
      kind: ASK_USER_ANSWERS_KIND,
      selections: answers.answers.map((answer) => [...answer.selected]),
    } satisfies AskUserAnswersStructuredContent,
  };
}

function isAskUserAnswersStructuredContent(
  value: unknown,
): value is AskUserAnswersStructuredContent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AskUserAnswersStructuredContent>;
  return (
    candidate.kind === ASK_USER_ANSWERS_KIND &&
    Array.isArray(candidate.selections) &&
    candidate.selections.every(
      (selection) =>
        Array.isArray(selection) &&
        selection.every((answer) => typeof answer === "string"),
    )
  );
}

/** Pair each persisted selection with its short question header. */
export function readAskUserAnswerSummary(
  structuredContent: unknown,
  legacyText: string,
  headers: string[] = [],
): AskUserAnswerSummaryItem[] {
  const legacyAnswers = legacyText
    .split(/\n\n(?=Q\d+ \[)/)
    .map((entry) => {
      const marker = entry.indexOf("\n→ ");
      if (marker < 0) return null;
      const answer = entry.slice(marker + 3).trim();
      if (!answer || answer === "(no selection)") return null;
      const header = /^Q\d+ \[([^\]]*)\]/.exec(entry)?.[1] ?? "";
      return { header, selections: [answer] };
    })
    .filter((answer): answer is AskUserAnswerSummaryItem => answer !== null);

  if (isAskUserAnswersStructuredContent(structuredContent)) {
    return structuredContent.selections.map((selection, index) => ({
      header: headers[index] ?? legacyAnswers[index]?.header ?? "",
      selections: [...selection],
    }));
  }
  return legacyAnswers;
}
