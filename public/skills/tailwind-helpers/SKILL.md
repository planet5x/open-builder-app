---
name: tailwind-helpers
description: Production-grade Tailwind CSS patterns for responsive layouts, dark mode, spacing scales, shadcn integration, and accessible color usage. Load before writing any styled UI.
version: 1.0.0
tags:
  - tailwind
  - css
  - ui
---

# Tailwind Helpers

## Responsive breakpoints

Tailwind's default breakpoints, in order:

| Prefix | Min width | Typical use                |
| ------ | --------- | -------------------------- |
| `sm:`  | 640px     | large phones / portrait    |
| `md:`  | 768px     | tablets                    |
| `lg:`  | 1024px    | desktops                   |
| `xl:`  | 1280px    | wide desktops              |
| `2xl:` | 1536px    | ultra-wide                 |

Default to mobile-first: write base styles for the smallest screen, then add `sm: md: lg:` overrides as the layout opens up. Do not write `lg:` then "undo" it at `sm:`.

Common patterns:

- One-up to two-up: `grid grid-cols-1 md:grid-cols-2`
- Stack to row: `flex flex-col md:flex-row gap-4`
- Hidden on mobile: `hidden md:block`
- Hidden on desktop: `md:hidden`
- Adaptive padding: `p-4 md:p-6 lg:p-8`

## Dark mode

Use the `dark:` variant. Make sure the surrounding scope toggles via class (the standard shadcn pattern) and that text/background tokens come in pairs.

```
<div class="bg-background text-foreground border border-border">
```

Avoid `dark:bg-zinc-900` style ad-hoc colors — prefer the semantic tokens (`background`, `foreground`, `muted`, `muted-foreground`, `accent`, `border`, `primary`, `destructive`). They are already dark-mode aware via CSS variables.

Inline literal colors should be reserved for status accents that are intentionally constant (e.g. amber warning banner, green success).

## Spacing scale

The `1` step is `0.25rem` (4px). Stick to the scale; do not invent arbitrary values unless you have a strict design constraint.

| Class | px  | Use                                     |
| ----- | --- | --------------------------------------- |
| `0.5` | 2   | hairline                                |
| `1`   | 4   | between very tight inline elements      |
| `2`   | 8   | between tight elements                  |
| `3`   | 12  | between related items                   |
| `4`   | 16  | default gap inside a card               |
| `6`   | 24  | between sections inside a page          |
| `8`   | 32  | between major page regions              |
| `12`  | 48  | top-level page padding                  |

Use `gap-*` on flex/grid for element spacing. Reserve `space-y-*` / `space-x-*` for non-flex stacks; they don't compose with wrapping flex.

## shadcn/ui conventions

- Always pass `className` through — never hard-set `Button`/`Input` styles inline that override the variant. Override via `className` + `cn()` from `@/lib/utils`.
- For sizing variants stick to shadcn's: `size="sm"`, `size="lg"`, `size="icon"`. Custom sizes should use the `default` variant + className.
- Combine multiple conditional classes with `cn()` (clsx + tailwind-merge): `cn("base", isActive && "ring-2", className)`. Do not concatenate raw strings.

## Layout primitives

```
flex items-center justify-between gap-3        // header bar
flex flex-col gap-2                            // vertical list
grid grid-cols-[auto_1fr_auto] items-center    // icon + title + action row
absolute inset-0                               // overlay fill
```

## Focus and accessibility

- Every interactive element gets a visible focus ring. shadcn `Button` already does this — do not strip `focus-visible:*` classes.
- Use `aria-pressed` for toggle buttons, `aria-expanded` for disclosure buttons.
- Tap targets on touch should be at least `h-9 w-9` (36px); 44px is the WCAG goal.
- Color contrast: `text-muted-foreground` is intentionally low-contrast; never put critical text on it.

## Common mistakes

- Mixing `space-x-*` with `gap-*` — pick one.
- `w-full` on a flex item where you actually wanted `flex-1`.
- `min-h-screen` everywhere — usually `min-h-0` + flex parents is what you actually want.
- Hardcoded colors (`bg-gray-100`) in a component that lives in a dark-mode app.
- Padding inside a button via `pl-/pr-` instead of using shadcn's `size` variant.
