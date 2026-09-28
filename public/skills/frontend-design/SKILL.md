---
name: frontend-design
description: Create distinctive, production-grade product interfaces and web components with strong hierarchy, accessibility, and a coherent visual direction. Use for dashboards, settings, forms, application flows, and general frontend styling.
version: 1.0.0
author: Open Builder adaptation of Anthropic frontend-design
tags:
  - frontend
  - product-ui
  - design
  - accessibility
---

# Frontend design

Create production-ready frontend interfaces that feel intentional rather than templated. The user's requirements, the existing project's architecture and visual language, active mode and tool restrictions, and the tools actually available in Open Builder always take priority over this guidance.

This Open Builder adaptation removes provider-specific self-reference and turns aesthetic absolutes into context-sensitive decisions. Source and license details are in `SOURCE.md` and `LICENSE.txt`.

## Routing boundary

- Use this skill for ordinary product UI: dashboards, settings, forms, CRUD surfaces, navigation, application shells, data views, multi-step workflows, and reusable components.
- Use `design-taste-frontend` for landing pages, portfolios, editorial or campaign pages, and highly art-directed marketing redesigns.
- When one request spans both, apply this skill to the product surfaces and `design-taste-frontend` to the marketing surfaces. Preserve one shared brand system across them.

## Start with evidence

For an existing project, inspect the relevant files before designing. Identify:

- the user goal, audience, primary task, and critical states;
- the current framework, component library, tokens, typography, icons, and layout primitives;
- behavior and contracts that must not change;
- responsive, accessibility, performance, and asset constraints;
- whether the user asked to preserve, refresh, or replace the current visual direction.

Do not install a new design system, font, icon library, animation library, or state layer merely because it is familiar. Reuse what the project already has unless a change is necessary and authorized.

## Choose a clear direction

Name a concise design direction before substantial UI work. It should connect purpose and audience to an aesthetic, not just list fashionable adjectives.

Consider:

- **Purpose:** What job must the interface help someone complete?
- **Tone:** Calm, utilitarian, editorial, playful, technical, premium, dense, approachable, or another direction supported by the brief.
- **Differentiator:** One memorable compositional, typographic, interaction, or content idea that supports the product.
- **Constraints:** Existing brand, accessibility, performance budget, content density, localization, and available assets.

Bold maximalism and refined minimalism can both work. Intentionality matters more than visual intensity.

## Build the hierarchy first

1. Put the primary task and current state where users can find them quickly.
2. Establish page, section, and component hierarchy before decoration.
3. Use spacing and grouping to express relationships; do not make every region a card.
4. Reserve strong color, scale, and motion for important actions or state changes.
5. Keep repeated controls predictable across screens.
6. Design empty, loading, error, disabled, success, and long-content states along with the happy path.

For data-dense products, clarity and scanability outrank novelty. For creative tools or consumer products, allow more expressive composition without obscuring tasks.

## Typography

- Start from the project's existing type stack. Introduce a new typeface only when it supports the direction and can be loaded reliably.
- Use a small, explicit scale with deliberate weight, line-height, and measure.
- Give headings a clear relationship to body and metadata text.
- Avoid making every label uppercase, monospaced, or letter-spaced; use those treatments only when they communicate a real category or tone.
- Do not reject system fonts or common families when the brief calls for neutrality, performance, or platform familiarity.

## Color and surfaces

- Define semantic tokens such as background, surface, elevated surface, text, muted text, border, accent, success, warning, and destructive.
- Meet WCAG 2.1 AA contrast for text and meaningful controls.
- Use one dominant neutral family and a restrained accent strategy unless the product genuinely benefits from a broader palette.
- Communicate state with text, iconography, shape, or position as well as color.
- Avoid decorative gradients, glass, neon glows, and oversized shadows unless they are part of the chosen direction.
- Test both light and dark themes when the project supports them; do not let individual sections silently switch theme.

## Layout and composition

- Use responsive structure that follows information priority, not just a desktop grid collapsed mechanically.
- Keep controls and copy readable at narrow widths, 200% zoom, long translations, and realistic data lengths.
- Avoid card-in-card nesting and a uniform grid of identical feature cards when simpler grouping or a different layout communicates more clearly.
- Preserve expected locations for navigation, search, account, primary actions, and destructive actions unless the brief justifies a change.
- Let dense surfaces be compact and airy surfaces breathe; do not apply one spacing rhythm to every context.

## Components and interaction

- Prefer native semantic elements and the project's established primitives.
- Use real labels, visible focus, keyboard access, and appropriate hit targets.
- A dialog needs a visible title, a reachable close control when dismissal is allowed, Escape behavior, focus management, and safe backdrop handling.
- Icon-only controls need a shared visible tooltip and an accessible name.
- Use progressive disclosure for advanced or infrequent controls, but do not hide critical state.
- Motion must communicate hierarchy, feedback, continuity, or state. Respect `prefers-reduced-motion` and avoid unnecessary dependencies.
- Keep user input stable during async work, prevent accidental duplicate actions, and show actionable errors near their source.

## Visual assets

Use existing project assets first. If the request needs new imagery, use only image or search tools available in the current run and respect licensing and attribution. Never fabricate a real brand logo, customer claim, screenshot, or test result. When no suitable asset is available, choose a coherent code-native treatment or clearly report the limitation rather than building a deceptive fake product screenshot.

## Implementation discipline

- Match complexity to the direction. A restrained interface needs precise spacing and states, not elaborate effects; an expressive interface may justify richer composition and motion.
- Preserve behavior while changing presentation unless behavior changes are explicitly in scope.
- Centralize reusable tokens and variants, but do not create speculative abstraction for one occurrence.
- Keep data and state logic separate from purely presentational decisions where the current architecture supports it.
- Use complete content and functional controls. Do not ship placeholder interactions or decorative controls that do nothing.
- Validate dependencies before adding them and account for bundle, maintenance, and runtime cost.

## Pre-flight review

Before declaring the UI complete, verify:

1. The primary task, current state, and primary action are obvious.
2. The implementation matches the named direction and existing brand rather than a generic AI template.
3. Loading, empty, error, disabled, long-content, and narrow-screen states remain usable.
4. Keyboard order, labels, focus, contrast, zoom, and reduced motion meet the project's accessibility baseline.
5. Repeated components use consistent tokens and behavior without unnecessary nesting.
6. No user-visible behavior, route, selector, asset key, or data contract changed accidentally.
7. The available project checks pass, and any unrun browser or device verification is reported honestly.
