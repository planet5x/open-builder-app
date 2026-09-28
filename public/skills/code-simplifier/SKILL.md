---
name: code-simplifier
description: Simplify user-specified or newly modified code for clarity, consistency, and maintainability while preserving exact behavior. Follow AGENTS.md, CLAUDE.md, and established project conventions; avoid broad cleanup.
version: 1.0.0
author: Open Builder adaptation of Anthropic code-simplifier
tags:
  - refactoring
  - maintainability
  - clarity
---

# Code simplifier

Refine code so it is easier to read, reason about, test, and maintain without changing its behavior. Work only on code the user identified or code modified in the current request unless the user explicitly broadens the scope.

This Open Builder adaptation replaces fixed provider-specific style rules with the actual project's `AGENTS.md`, `CLAUDE.md`, formatter and lint configuration, nearby code, and established conventions. Source and license details are in `SOURCE.md` and `LICENSE.txt`.

## Required boundaries

1. **Preserve behavior and contracts.** Inputs, outputs, side effects, error semantics, ordering, public types, routes, selectors, stored formats, and performance-sensitive characteristics must remain intact unless the user asked to change them.
2. **Read before editing.** Inspect the target, its callers and consumers, relevant tests, and project guidance. Do not infer a convention from generic preference when the repository provides evidence.
3. **Keep scope surgical.** Do not opportunistically simplify untouched modules, rename public APIs, migrate libraries, or reformat unrelated files.
4. **Prefer the simplest sufficient code.** Remove accidental complexity, not useful structure. Do not replace one clear abstraction with a clever one-liner or introduce speculative helpers for a single use.
5. **Verify equivalence.** Run the narrowest relevant checks, then broader project gates in proportion to risk. Report any runtime or browser evidence not run.

## What to improve

- Reduce avoidable nesting with early returns when they make control flow clearer.
- Replace repeated expressions with a well-named local value when it clarifies intent.
- Consolidate genuinely duplicated logic while preserving distinct business rules.
- Improve names that hide purpose or invariants without causing an unnecessary public rename.
- Strengthen types and narrowing when it removes ambiguity without changing runtime behavior.
- Delete dead branches, unused imports, obsolete comments, and helpers made redundant by this request.
- Keep comments for invariants, tradeoffs, protocol details, and non-obvious workarounds; remove comments that merely restate the code.
- Break apart functions or components only when they mix distinct responsibilities or become materially easier to test and understand.
- Prefer explicit `if`/`else`, `switch`, or named predicates over deeply nested ternaries and dense boolean expressions.
- Preserve existing error handling style unless it is itself the source of unnecessary complexity.

## What not to do

- Do not optimize for fewer lines.
- Do not flatten useful domain abstractions or combine unrelated responsibilities.
- Do not add generalized factories, registries, configuration, compatibility layers, or fallback paths without current consumers.
- Do not change sync/async behavior, execution order, error types, logging, cancellation, caching, or concurrency semantics accidentally.
- Do not silently broaden types, use `any`, suppress lint rules, or weaken validation to make code shorter.
- Do not rewrite working code into a personal style that conflicts with the repository.
- Do not add dependencies for a simplification that local language or project primitives can express clearly.
- Do not modify generated files, vendored code, lockfiles, or migrations unless the requested simplification requires it.

## Workflow

1. Define the exact files or changed regions in scope.
2. Read project instructions, tests, and nearby examples.
3. State the behavior and invariants that must remain unchanged.
4. Identify specific complexity with a concrete payoff for simplifying it.
5. Make the smallest coherent edits.
6. Review the diff for accidental behavior changes and unrelated churn.
7. Run focused tests, type checking, linting, formatting, or build checks that cover the change.
8. Summarize only material simplifications and any verification boundaries.

If the current code is already the clearest form, leave it alone and say so. A no-op is better than cosmetic churn.
