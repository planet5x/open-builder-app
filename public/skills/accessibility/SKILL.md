---
name: accessibility
description: Web accessibility essentials covering semantic HTML, keyboard navigation, ARIA usage, focus management, contrast, and accessible forms. Load before building any interactive component.
version: 1.0.0
tags:
  - a11y
  - wcag
  - ui
---

# Accessibility

WCAG 2.1 AA is the practical baseline. Build to it; treat it as ground level, not a stretch goal.

## Semantic HTML first

Reach for the native element before reaching for ARIA. ARIA is the patch you apply when nothing native fits.

- Use `<button>` for clickable actions, `<a>` only for navigation.
- Use `<form>` + `<label>` for inputs. Always pair `<label htmlFor>` with input `id`.
- Use heading levels in order (`h1` → `h2` → `h3`). Do not skip levels to hit a font-size — use Tailwind classes for size.
- Use `<nav>`, `<main>`, `<aside>`, `<section>` for landmarks. Exactly one `<main>` per page.
- Use `<ul>` / `<ol>` for lists. Do not fake a list with `div`s.

Anti-pattern: `<div onClick={...}>` for clickable things. It is invisible to keyboard and screen readers.

## Keyboard navigation

Every interactive element must:

- Receive focus via `Tab`.
- Activate via `Enter` (buttons, links) or `Space` (buttons, checkboxes).
- Show a visible focus ring (do not strip `focus-visible:*`).
- Be reachable in DOM order that matches visual order.

Custom widgets:

- A close button on a modal should be early in the DOM so `Tab` reaches it quickly, and `Escape` should close the modal.
- A menu (dropdown) should support `ArrowUp` / `ArrowDown` to move, `Enter` to choose, `Escape` to close.
- A modal should trap focus inside while open and restore focus to the trigger when closed.

## ARIA: minimum effective set

Use these when native semantics fall short:

| Attribute              | Use                                              |
| ---------------------- | ------------------------------------------------ |
| `aria-label`           | give an unlabeled icon-only control a name       |
| `aria-pressed`         | a toggle button's on/off state                   |
| `aria-expanded`        | a disclosure / accordion / menu trigger's state  |
| `aria-current="page"`  | the current item in a nav                        |
| `aria-live="polite"`   | a region that announces non-urgent updates       |
| `role="alert"`         | an error message that should be announced now    |
| `aria-describedby`     | tie an input to its hint or error                |

Rules:

- Never `aria-label` something that already has a visible text label.
- Never set `role="button"` on a `<div>` if you could just use `<button>`.
- Never use `aria-hidden="true"` on something that is focusable — that's a bug.

## Forms

- One `<label>` per field. `htmlFor` matches the input `id`.
- Required fields: `required` plus `aria-required="true"` is redundant — the browser exposes it.
- Inline errors: render below the input and reference via `aria-describedby` on the input. When the error appears, the screen reader announces it.
- Placeholders are not labels. They disappear on focus and have poor contrast.
- Use `autocomplete` attributes (`autocomplete="email"`, `autocomplete="current-password"`). They speed real users up.

## Color and contrast

WCAG AA contrast minimums:

- Normal text (under 18pt): 4.5:1 against background.
- Large text (18pt+ or 14pt bold): 3:1.
- UI components and graphical elements: 3:1.

Do not encode information in color alone. A red error state must also have an icon or label. A "selected" state needs more than just a hue change.

`text-muted-foreground` in shadcn is around 3.5:1 — fine for secondary text, not for primary content.

## Motion

- Respect `prefers-reduced-motion`. For non-essential animation, gate behind a media query and provide a still alternative.
- Do not auto-rotate carousels without a pause control.
- Avoid flash rates above 3Hz — they can trigger seizures.

## Images

- Decorative image: `alt=""` (not missing — empty).
- Meaningful image: short `alt` describing what it conveys, not what it looks like ("expand sidebar", not "right-pointing arrow icon").
- Complex image (chart): `alt` summarizes the headline finding; provide the data in text nearby.

## Quick audit checklist

Before shipping a feature:

1. Tab through the new UI with the keyboard. Can you reach and use everything?
2. Open it with screen reader (VoiceOver: Cmd+F5). Are labels read out?
3. Disable mouse hover styles. Are focus states still visible?
4. Zoom browser to 200%. Does layout hold?
5. Test in dark mode and light mode. Contrast still passes?
