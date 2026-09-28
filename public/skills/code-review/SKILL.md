---
name: code-review
description: Review a diff, file set, or current project changes for correctness, security, performance, reliability, and maintainability. Use project evidence, prioritize actionable findings, and report only unless the user explicitly asks for fixes.
version: 1.0.0
author: Open Builder adaptation of Anthropic code-review
tags:
  - review
  - correctness
  - security
  - performance
---

# Code review

Review the requested change set with a skeptical, evidence-based lens. This Open Builder adaptation removes slash-command, argument-placeholder, and Connector-specific syntax. Use the project and read-only tools available in the current run. Source and license details are in `SOURCE.md` and `LICENSE.txt`.

## Default boundary

Review and report; do not edit files, update tickets, post comments, or change external state unless the user explicitly asks for those actions. If the user asks to review and fix, establish findings first, then make only the authorized fixes.

If the target is not explicit, infer it from the current request and available change context. Use `list_files`, `read_files`, and `search_in_files` to discover facts before asking the user. Ask only when multiple materially different review targets remain.

## Establish the review scope

1. Identify whether the target is a supplied diff, current working changes, named files, a branch or PR represented in the available project, or the full repository.
2. Read repository instructions such as `AGENTS.md`, `CLAUDE.md`, project docs, schemas, tests, and nearby code that define intended behavior.
3. Trace changed interfaces to their callers and consumers. A diff without its surrounding contract is often misleading.
4. Distinguish pre-existing issues from regressions introduced by the reviewed changes.
5. Do not claim CI, browser, deployment, database, or production evidence that was not actually observed.

## Review dimensions

### Correctness

- Missing edge cases: empty, null, malformed, duplicated, oversized, stale, or partially available input.
- Incorrect branching, off-by-one errors, lost updates, state drift, ordering assumptions, and race conditions.
- Broken public contracts, payloads, routes, selectors, migrations, serialization, or backwards compatibility.
- Error paths that swallow failures, retry unsafe work, leak partial state, or mislead users.
- Tests that assert implementation details while missing the behavior at risk.

### Security and privacy

- Injection, XSS, CSRF, SSRF, path traversal, unsafe deserialization, command execution, and origin validation.
- Authentication vs authorization gaps, tenant or ownership isolation failures, insecure defaults, and privilege escalation.
- Secret or personal-data exposure in code, client bundles, logs, telemetry, URLs, caches, or errors.
- Trust-boundary mistakes involving project files, remote content, tools, plugins, user imports, and generated output.
- Resource exhaustion, unbounded reads, decompression bombs, and missing size or rate limits.

### Performance and reliability

- N+1 queries, repeated network or filesystem work, unbounded loops, large synchronous operations, and avoidable render churn.
- Leaked subscriptions, timers, streams, object URLs, browser sessions, handles, or background processes.
- Missing cancellation, timeouts, idempotency, concurrency control, backpressure, or atomicity where failures can overlap.
- Cache invalidation errors, stale snapshots, and assumptions that only hold in one runtime.

### Maintainability

- Code that obscures invariants, duplicates domain logic, weakens types, or introduces a second pattern without need.
- Unnecessary abstractions, configuration, fallbacks, dependencies, or broad refactors outside the change's purpose.
- Naming and structure that make behavior harder to trace.
- Missing focused tests or documentation for a non-obvious contract.

Style-only preferences are not findings unless they create a concrete correctness, security, performance, accessibility, or maintenance cost.

## Validate each finding

Before reporting an issue:

1. Cite the exact file and tightest useful line or symbol.
2. Explain the concrete trigger or execution path.
3. State the observable impact.
4. Check nearby guards, callers, tests, and framework behavior that might invalidate it.
5. Calibrate severity to likelihood and impact rather than dramatic wording.
6. Give a scoped remediation direction without rewriting unrelated code.

Do not report speculative issues that cannot be tied to an actual path. If evidence is incomplete, label the uncertainty and say what would confirm it.

## Severity

- **Critical:** readily exploitable or catastrophic data/authority loss with broad impact.
- **High:** likely serious security, data integrity, availability, or core-workflow failure.
- **Medium:** real defect with meaningful but bounded impact or a less likely severe path.
- **Low:** concrete maintainability, accessibility, or robustness issue with limited immediate impact.

## Output

Lead with findings, ordered by severity. For each finding include:

- severity and concise title;
- file and line or symbol;
- trigger and impact;
- evidence and why existing checks do not prevent it;
- focused fix direction and a regression-test scenario.

After findings, list assumptions or unverified runtime boundaries. Add a short overall assessment only after the actionable issues. If there are no reportable findings, say so plainly and note any testing or scope gaps; do not invent positive filler.
