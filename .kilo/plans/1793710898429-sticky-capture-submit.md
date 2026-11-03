# Plan: Sticky submit button in line capture form

## Goal
Keep the `#line-capture-form > button` (Save/Add part) visible while scrolling the sidebar form, eliminating the need to scroll down/up on every edit.

## Context
- The capture form lives in the right sidebar (`.line-sidebar`), which is a scroll container: `max-height: calc(100vh - 218px); overflow-y: auto`.
- `.line-capture-form` is a grid with `gap: 13px` and the submit button (`.line-save-button`) is the last child, so it sits at the bottom of the tall form.
- The button is currently `position: static`, requiring full scroll to reach.

## Change
Add sticky positioning to `.line-save-button` so it sticks to the bottom of the scrolling sidebar while the form fields scroll above it.

### CSS (`src/styles.css`)
- `.line-save-button`: add `position: sticky; bottom: 8px; z-index: 2;` plus a solid background (`background: var(--surface, #fff)` or panel bg) and a top border/shadow so content doesn't show through while scrolling.
- Ensure the sidebar's scroll container has `overflow-y: auto` (already does) so sticky works.
- Add a small bottom margin/padding to `.line-capture-form` so the sticky button doesn't overlap the last field at rest (e.g., `padding-bottom: 64px` or a spacer).

### Risks / edge cases
- Sticky element's containing block must be the scroll container. `.line-save-button` is nested inside `.line-capture-form` inside `.line-capture-panel` inside `.line-sidebar`. Sticky works relative to nearest scroll ancestor with overflow, which is `.line-sidebar` — good. But the sticky element must not be inside an element with `overflow: hidden`. Check `.line-capture-panel`/`.panel` for overflow.
- Background must be opaque to avoid ghosting text behind the sticky button.
- On very short viewports, the button may overlap fields; the padding-bottom spacer mitigates.
- Mobile/responsive: check `.line-layout` media queries (line 6184) for sidebar stacking; sticky bottom may need adjustment when sidebar is full-width.

## Validation
- `npm run lint` / `npm run typecheck` (no TS changes expected).
- Manual: open Song page, link audio, scroll sidebar; confirm Save/Add button remains visible at bottom while fields scroll.
- Test edit flow: select a part → form populates → button stays reachable without manual scroll.

## Open questions
- Should the button also stick in the main (non-sidebar) layout on mobile? Confirm after inspecting responsive CSS around line 6184.