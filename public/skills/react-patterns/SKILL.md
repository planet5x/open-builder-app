---
name: react-patterns
description: Modern React 19 patterns for building maintainable components. Use when writing or refactoring React code (JSX/TSX), choosing between hooks, designing component APIs, or wiring state management.
version: 1.0.1
author: open-builder
tags: [react, frontend, best-practices]
---

# React patterns

Apply these patterns when writing React 19 components inside the generated project.

## Component structure

- Default to function components. Class components are not needed.
- Co-locate component, types, and styles in one file unless the file exceeds ~200 lines.
- Export the main component as a named export, not a default export. This keeps the import name consistent across the codebase.
- Keep components single-purpose. If a component handles more than one concern, split it.

## State

- Reach for `useState` first. Only introduce a reducer when state transitions are non-trivial or involve more than three fields.
- Lift state up only when more than one sibling reads it. Otherwise keep it local.
- For state that needs to persist across reloads, write to localStorage in a `useEffect`, not during render.

## Effects

- Treat `useEffect` as a synchronization primitive between React state and an external system, not a way to "run code after render".
- Every effect must have a complete dependency array. Do not suppress lint errors by passing `[]` for an effect that reads props or state.
- Cleanup is mandatory for subscriptions, timers, and event listeners — return a cleanup function.

## Performance

- Do not preemptively wrap components in `memo`. Measure first.
- Use `useMemo` only for expensive computations or for stable reference identity passed to memoized children. Do not use it for primitives.
- Use `useCallback` only when the callback is a dependency of another hook or passed to a memoized child.

## Props and types

- Define a `Props` interface for every component with more than one prop. Inline `{a, b}: {a: string; b: number}` is fine for one or two simple props.
- Prefer required props with sensible defaults inside the component over optional props with `??` everywhere downstream.
- Avoid boolean prop explosion. If a component has more than three boolean props, refactor to a discriminated union or composition.

## Composition over configuration

- Children, slots, and render props beat boolean flags. A `<Card><Card.Header /></Card>` API ages better than `<Card showHeader headerTitle="...">`.
- Compound components: expose subcomponents as static properties (`Card.Header = ...`) when they only make sense inside the parent.

## Forms

- Controlled inputs are the default. Use `useState` per field for simple forms; use one state object only when fields are tightly coupled.
- Validate on blur for non-critical fields, on submit for the final check. Avoid validating on every keystroke.

## When to ask

If the user request is ambiguous about which of these patterns to apply, prefer the simplest one that satisfies the spec and surface the trade-off in your reply.
