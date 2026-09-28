---
name: typescript-patterns
description: TypeScript patterns and conventions for safer, more maintainable code. Covers narrowing, discriminated unions, satisfies, unknown vs any, type guards, and when to keep types simple.
version: 1.0.0
tags:
  - typescript
  - patterns
---

# TypeScript Patterns

The goal: types that catch real bugs without making the code harder to read. Lean on inference; reach for advanced types only when they pay rent.

## Prefer narrowing over casting

If you find yourself writing `as SomeType`, ask whether narrowing would work instead. Casts disable the checker; narrowing keeps it on.

```ts
function handle(value: string | null) {
  if (value === null) return;
  // value is now `string`
  value.toUpperCase();
}
```

Cast only when you have *more information than the compiler* (e.g. parsed JSON whose shape you just validated). Even then, narrow at the boundary — don't sprinkle casts through the call tree.

## Discriminated unions

When a type has multiple variants, give each a literal `kind` field. The compiler narrows on it without effort.

```ts
type Result =
  | { kind: "ok"; value: number }
  | { kind: "err"; message: string };

function show(r: Result) {
  if (r.kind === "ok") {
    return r.value;     // narrowed to ok
  }
  return r.message;     // narrowed to err
}
```

Better than a boolean flag — it scales to N variants and keeps each variant's fields scoped to where they exist.

## `unknown` not `any`

`any` opts out of the checker; `unknown` keeps it on and forces narrowing.

```ts
function parse(raw: string): unknown {
  return JSON.parse(raw);
}

const data = parse(input);
if (typeof data === "object" && data !== null && "id" in data) {
  // narrowed; still must check `data.id` shape
}
```

Use `any` only when interfacing with an untyped library and there's no realistic alternative. Even then, wrap it in a narrow boundary function with a typed return.

## `satisfies` for literal-typed config

`satisfies` checks a value against a type without widening it. Useful for configs and registries.

```ts
const config = {
  "react-patterns": { version: "1.0.0" },
  "debugging":      { version: "1.0.0" },
} satisfies Record<string, { version: string }>;

// config["react-patterns"] is still keyed to "react-patterns" exactly,
// not widened to string — autocomplete still works on the keys.
```

Without `satisfies`, you'd lose the precise key types if you typed `: Record<...>` directly.

## Type guards, not duck checks

If you check the shape in two places, extract a guard.

```ts
interface User { id: string; name: string }

function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).name === "string"
  );
}
```

For external input (API, postMessage, storage), validate with a schema library (Zod) instead of hand-rolling guards. The library handles the boring cases consistently.

## Avoid overly generic generics

Generic types should be motivated. If a function has one type parameter and uses it once, the parameter is probably noise.

Bad:
```ts
function getFirst<T>(arr: T[]): T | undefined { return arr[0]; }
function logIt<T>(x: T): void { console.log(x); }   // doesn't need T
```

The first is fine — the parameter shows up in the return. The second isn't — replace `T` with `unknown`.

Don't ship `<T extends Record<string, unknown>>` machinery just to satisfy a stylistic preference. The simpler signature usually catches the same bugs and is much easier to read.

## `readonly` where it matters

Mark function parameters that aren't mutated as `readonly`. It documents intent and catches accidental writes.

```ts
function sum(nums: readonly number[]): number {
  // nums.push(0); // error — good
  return nums.reduce((a, b) => a + b, 0);
}
```

For object types, `Readonly<T>` or per-field `readonly` works the same way.

## Don't type internal-only state aggressively

In a component, `useState<string>("")` and `useState("")` produce the same thing — skip the annotation. Annotate when:

- Initial value is `null` and you'll set a real value later: `useState<User | null>(null)`.
- Initial value's literal type isn't what you want: `useState<"idle" | "loading" | "done">("idle")`.
- Function-prop types where structural matching is ambiguous.

## Common bugs the type system catches

- Forgetting a case in a switch: use `never` exhaustiveness.
  ```ts
  function area(s: Shape): number {
    switch (s.kind) {
      case "circle": return Math.PI * s.r ** 2;
      case "square": return s.side ** 2;
      default: {
        const _exhaustive: never = s;
        throw new Error(`unhandled: ${_exhaustive}`);
      }
    }
  }
  ```
- Off-by-one on optional chaining: `obj?.foo.bar` will still throw if `obj` is defined but `foo` is undefined; you want `obj?.foo?.bar`.
- Mixing up `||` and `??`: `value ?? 0` falls back only on `null`/`undefined`; `value || 0` also falls back on `""` and `0`.

## When to write a type vs an interface

For object shapes you'll extend or implement, prefer `interface`. For unions, tuples, computed types, prefer `type`. Both are fine for plain object shapes — pick one and be consistent in the file.
