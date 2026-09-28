---
name: debugging
description: Systematic debugging workflow for runtime errors, white screens, and unexpected behavior in web apps. Use when the preview breaks or behaves wrongly.
version: 1.0.0
tags:
  - process
  - debugging
---

# Systematic Debugging

Use this when something is broken — console error, white screen, layout collapse, wrong data, etc. Do not start by guessing or rewriting code. Move through these phases in order.

## 1. Reproduce

Capture the exact failure first, before you change anything.

- Open the preview and reproduce the bad behavior.
- Pull `get_console_logs` to capture the runtime output.
- Note the user-visible symptom in one sentence ("nothing renders", "form submit shows blank toast", "list items disappear after 3 seconds").

If you cannot reproduce, stop and ask the user for steps. Do not start editing.

## 2. Localize

Find the smallest area of code that produces the symptom.

- Read the top stack frame in the console error — that is your starting point.
- If the stack is opaque or minified, `search_in_files` for an exact substring of the error message or the user-visible symptom string.
- Open the suspect file(s) with `read_files`. Re-read them; do not rely on memory.
- Identify the function, hook, or component that owns the failure.

## 3. Hypothesize

State a single, falsifiable hypothesis about the root cause.

Write it as: `Because <X>, the code produces <observed symptom>.`

Examples of good hypotheses:
- "Because `useEffect` runs after the initial paint and `items` is `undefined` until then, the `.map` throws."
- "Because the API returns `data.results` (not `data.items`), the destructure on line 42 produces `undefined`."

Vague guesses ("something is wrong with state") are not hypotheses — sharpen them first.

## 4. Verify the hypothesis

Confirm or kill the hypothesis with the smallest possible test.

- Add a `console.log` near the suspected line, re-trigger, read `get_console_logs`.
- If the hypothesis depends on shape of API data, log the actual shape.
- If the hypothesis depends on timing, log entry/exit of the effect or handler.

Do not move to a fix until the hypothesis is verified. If it is wrong, return to step 3 with what you just learned.

## 5. Fix

Make the smallest change that addresses the verified cause.

- Do not refactor surrounding code while fixing. One bug, one change.
- Do not add a `try/catch` that swallows the error — fix the cause.
- Do not add a feature flag or fallback "in case it happens again".

## 6. Verify the fix

After the change, re-trigger the original repro and re-pull `get_console_logs`. Confirm:

- The original symptom is gone.
- No new errors or warnings appeared.
- Other features the change touched still work.

If the fix produced a new error, you have not actually fixed the bug — you moved it. Return to step 2.

## 7. Prevent regression

Before declaring done:

- If the fix was non-obvious, leave a one-line comment explaining *why* (not what).
- If the bug came from a data-shape mismatch, narrow the type at the boundary so it cannot silently happen again.
- If it came from a missing null check on something the component owner controls, fix the owner instead of the consumer.

## Anti-patterns

- Editing files before you have logs.
- Rewriting the component because "the structure feels off". That is a refactor, not a fix.
- Adding `if (!x) return null` to suppress the symptom. That hides the bug; it does not fix it.
- "Try this and see." If you cannot say *why* a change would fix the bug, it probably won't.
