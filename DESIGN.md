# Design System

This app has a small, deliberate design system. Read this before touching UI —
it exists so new screens look like they belong next to the FIP player instead
of drifting into generic Tailwind defaults.

Source of truth: [`src/routes/layout.css`](src/routes/layout.css) (color and
radius tokens) and [`src/routes/+page.svelte`](src/routes/+page.svelte)
(reference implementation — copy patterns from here, don't reinvent them).

## Stack

- Svelte 5 (runes: `$state`, `$derived`, `{#if}`/`{#each}` — no legacy stores
  for local UI state)
- Tailwind CSS v4, tokens defined via `@theme` in `layout.css` (not
  `tailwind.config.js` — v4 doesn't use one)
- Utility-first, deliberately. There is no `@layer components` in this
  project. Repeated class combinations live as **plain string constants in
  `<script>`** (`pressable`, `iconHit` in `+page.svelte`), not custom CSS
  classes — see [Shared class strings](#shared-class-strings-not-css-classes).
- No icon library, no component library. Icons are hand-rolled inline SVG.
  Check existing icons in `+page.svelte` before adding a new one — most
  common shapes (moon/sun, star, share, transport controls, speaker) already
  exist and should be copied, not re-drawn differently.

## Tokens

All color is consumed as Tailwind utilities backed by CSS custom properties
(`bg-surface`, `text-ink`, `border-divider`, etc.), never raw hex, raw
`oklch()`, or Tailwind's default palette (`gray-500`, `indigo-600`, ...). This
is what makes dark mode a variable remap instead of a `dark:` class hunt —
and it's why there's no leftover `from-indigo-600 to-slate-900` gradient
anywhere in the app.

**Two raw oklch scales, everything else derived.** `layout.css` defines
exactly two 50→950 scales (lightest→darkest), constant hue, near-constant
chroma:

- `--color-sand-*` — warm neutral (hue 75), used for every background/text
  role
- `--color-coral-*` — brand accent (hue 25, ~`#FF4433`), currently only
  steps `100`/`400`/`500`/`900` are defined (that's all any role needs today)

Semantic roles are just a step from one of those two scales:

| Token                   | Light points at | Role                                               |
| ----------------------- | --------------- | -------------------------------------------------- |
| `--color-surface`       | `sand-50`       | Card/panel background                              |
| `--color-canvas`        | `sand-100`      | Page background behind the card                    |
| `--color-divider`       | `sand-200`      | Hairline borders between sections/rows             |
| `--color-ink-tertiary`  | `sand-400`      | Tertiary text (timestamps, tags, tuner ticks)      |
| `--color-ink-secondary` | `sand-600`      | Secondary text (subtitles, "Streaming now")        |
| `--color-ink`           | `sand-950`      | Primary text, primary button fill                  |
| `--color-accent`        | `coral-500`     | Live indicator, active state, progress fill, links |
| `--color-accent-subtle` | `coral-100`     | Tint background for badges/favorited icons         |
| `--color-loading`       | one-off amber   | Buffering/loading dot only; same value both themes |

**Dark mode doesn't hand-pick new colors.** `:root[data-theme='dark']` in
`layout.css` re-points the _same_ roles at _different steps of the same two
scales_ (e.g. `--color-surface: var(--color-sand-900)` instead of
`sand-50`). If you're ever tempted to write a fresh `oklch(...)` value for a
dark-mode override, stop — pick an existing sand/coral step instead, or add
one to the scale if none fits.

The one sanctioned exception is `--color-loading`: a single one-off amber
token (not part of either scale) used only for the buffering-state dot,
since no sand/coral step reads as "loading" without being confused for
accent or an error state. It's still a named token, not a literal — code
should never write `oklch(...)` inline (see the station-dot color blend in
`+page.svelte`, which animates between `--color-loading` and `--color-accent`
via `color-mix(in oklch, ...)` driven by a `Tween`, instead of swapping
between two hardcoded strings).

Components never branch on theme. If you write `class="bg-surface text-ink"`,
it's already dark-mode-correct. **Do not add Tailwind `dark:` variants.**

Theme switching is driven by a `data-theme` attribute on `<html>`, set:

- Synchronously in `src/app.html` (pre-hydration, reads `localStorage` /
  `prefers-color-scheme`) to avoid a flash of the wrong theme
- At runtime by `toggleTheme()` in `+page.svelte`, which also sets a
  `data-theme-switching` attribute for one frame so the whole page doesn't
  visibly cross-fade every color at once (see the `[data-theme-switching] *`
  rule in `layout.css` — this is the one thing in the file that can't be a
  Tailwind utility, since it's a global `*` selector)

There's also `--radius-card: 2rem` in `@theme`, giving the card
`rounded-card` instead of an arbitrary `rounded-[32px]`. Same idea as the
color scales: name the value once, reuse the name.

## Shared class strings, not CSS classes

Two buttons or more repeating the same handful of utilities is normal and
doesn't need a class. When a combination is used across the _whole app_
(press feedback, focus ring, touch hit-area), it becomes a plain string
constant in `+page.svelte`'s `<script>`, interpolated into `class=""`:

- **`pressable`** — press feedback (`scale(0.97)` on `:active`), a grey/black
  `focus-visible` outline (never a custom-colored ring — it tends to clash),
  and `prefers-reduced-motion` handling. Put this on every interactive
  `<button>` and on rows that act like one:
  `class="{pressable} flex h-14 ..."`.
- **`iconHit`** — for round icon-only buttons. Keeps the _visible_ circle
  small (matches the reference design, e.g. `size-9`, `size-8`) but pads the
  actual hit target out to ~44px via a `before:` pseudo-element utility, so
  touch targets are comfortable without changing how the control looks.
  Combine with `pressable`: `class="{iconHit} {pressable} size-9 ..."`.

This is a Tailwind-utility string, not a hand-written CSS rule — there's
nothing in it that couldn't be typed inline, it's just factored out so ten
buttons can't drift out of sync. If a new shared combination emerges, add
another constant next to `pressable`/`iconHit`; don't reach for
`@layer components` or a new `.css` class. Reach for custom CSS only when
Tailwind genuinely can't express it. The handful of examples in this app,
all in `layout.css`: `[data-theme-switching] *` (global `*` selector),
`.fip-info-dialog::backdrop` (the `::backdrop` pseudo-element isn't
reachable from a utility class), and the `history-scroll-mask`
`@property`/`@keyframes`/`animation-timeline: scroll()` block (scroll-driven
CSS animations have no Tailwind utility surface).

## Patterns to follow

**No layout shift on state change.** Elements whose presence toggles (the
live-station dot, favorite stars) are always mounted and toggle
`opacity`/`color`, never `{#if}`-conditionally rendered. Conditionally
rendering them would nudge sibling text left/right every time the state
flips. Same reasoning applies to font-weight: don't bump `font-weight` on
hover/active/selected — it reflows text. Change color instead.

**Icon buttons always get an `aria-label`.** No icon-only button ships
without one — screen readers have nothing else to read.

**Numbers that change use `tabular-nums`.** Timestamps, volume value, station
numbers — anything that updates or sits in a list where digits should align.

**Semantic elements.** Anything clickable is a real `<button>` (or `<a>` for
navigation), never a `<div onclick>`. Native focus/keyboard/AT behavior is
free; don't rebuild it.

**Motion**: `ease-out` for things entering/exiting, `ease` for hover/color
transitions, under 250ms for anything users trigger directly. Every
transition needs a `prefers-reduced-motion` story — either via `pressable`
(handles it for you) or `motion-reduce:transition-none` on one-off utility
transitions (see the station-row dot/text in `+page.svelte` for the pattern).

## Playback and metadata are real

Station switching is wired to actual `<audio>` playback (`streamUrl` per
station, `playbackState` state machine, `selectStation`/`selectAdjacentStation`
in `+page.svelte`) — selecting a station changes what's actually streaming,
not just which row is highlighted.

The now-playing panel uses `/api/current-track`, which combines Radio France
GraphQL song data with the live metadata feed for artwork and fresher
title/artist text. If metadata is unavailable or stale, the UI falls back to
the selected station and an honest live badge; don't hardcode fake track data
to make the interface look more complete.

## Extending the system

- **New color**: don't write a new `oklch(...)` literal. Either point a role
  at an existing `sand-*`/`coral-*` step, or — if no step fits — add one to
  the scale in `@theme` following the existing lightness/chroma progression,
  then point the role(s) at it (light and dark, if relevant).
- **New icon**: inline SVG, `viewBox="0 0 24 24"`, `stroke-width="2"` for
  line icons or `fill="currentColor"` for solid ones, sized via `class="size-*"`
  to match surrounding icons. Check the existing set first.
- **New icon button**: `class="{iconHit} {pressable} size-9 ..."` plus an
  `aria-label`.
- **New primary/secondary text**: `text-ink` / `text-ink-secondary` /
  `text-ink-tertiary` — pick by hierarchy, not by "what gray looks right."
