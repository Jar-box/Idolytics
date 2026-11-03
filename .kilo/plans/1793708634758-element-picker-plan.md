# Plan: Element picker ("copy element reference" for AI prompts)

## Goal
Add a way for the user to click any element on the page, copy a short description of it to the clipboard, and paste it into an AI prompt so the AI knows which element is being discussed.

## Context
- Repo: `C:\Users\jejer\Documents\Projects\Development\Personal\NewProjectKpop`
- Stack: Vite 8 + React 19 + TypeScript (strict), Zustand stores, lucide-react icons, vitest tests.
- Conventions: components under `src/components/` and `src/features/*/`, stores under `src/store/`, icons from `lucide-react`, toasts via `useToastStore`, className styling matching `src/styles.css`.

## Decisions (confirmed with user)
- **Activation:** keyboard shortcut `Ctrl/Cmd + Shift + I` + an icon button in `AppHeader` header-actions. Shortcut disabled while editing (input/textarea/select/contenteditable).
- **Copied payload:** generated CSS selector path (e.g. `main.app-main > section.stage-grid > button.btn`), plus tag name, `id`, `class`, `aria-label`, and trimmed visible text — rendered as a small markdown block and written to the clipboard via Clipboard API with a fallback.
- **Picker UX:** activating enters "picking mode"; hovered elements get a visible outline + small caption showing the selector; click copies and exits; `Esc` cancels without copying; toast confirms copy success/failure.
- **Scope:** app-wide across all views; picker UI itself is ignored.

## Files
- **Create** `src/lib/elementPath.ts` — pure functions: build selector path from an HTMLElement, extract attributes/text, format markdown block, `copyToClipboard` helper. Add unit tests in `src/lib/elementPath.test.ts`.
- **Create** `src/components/ElementPicker.tsx` — component that mounts a document-level click/mouseover listener when active, applies highlight outline + caption, handles click-to-copy and Esc-to-cancel. Exposes `isActive`, `activate`, `deactivate` via a small Zustand-like store or inline state lifted into App.
- **Create** `src/store/pickerStore.ts` — Zustand store: `isActive`, `activate`, `deactivate`, `copied` flag.
- **Modify** `src/App.tsx` — register global keydown listener for `Ctrl/Cmd + Shift + I` (guarded against editing targets), toggle picker active state, render `ElementPicker` once (portal-like, document body level).
- **Modify** `src/components/AppHeader.tsx` — add icon button (`<MousePointer2 />` or similar lucide icon) toggling picker, title "Pick element", disabled when picker already active.
- **Modify** `src/styles.css` — add `.element-picker-highlight` outline styles and `.element-picker-caption` absolute-positioned caption styling consistent with existing theme variables.

## Data flow
1. User presses shortcut or clicks header button → `pickerStore.activate()`.
2. `ElementPicker` mounts listeners; on `mouseover`, compute path for `event.target`, render/follow caption + outline.
3. On `click`, `event.preventDefault()`, build markdown payload, copy to clipboard, `deactivate()`, push success toast; on failure push error toast.
4. `Esc` → `deactivate()` without copying.

## Failure modes
- Clipboard API unavailable or denied → fallback to `execCommand('copy')` via temp textarea, then error toast if both fail.
- Click on the picker caption/highlight itself → ignore (let event pass through or target the real element beneath via `elementFromPoint` with pointer events suppressed on the overlay).
- Picker active while a modal/dialog is open → still works on the topmost element under cursor; no store coupling required.

## Validation
- `npm run typecheck` (tsc --noEmit) passes.
- `npm run test` (vitest run) passes, including new `elementPath.test.ts`.
- Manual: activate via shortcut and button, hover various elements (button, section, svg, input), verify caption/path updates, click copies payload, paste into AI prompt confirms selector matches target, Esc cancels, shortcut ignored while typing in an input.

## Open questions
None — all key decisions resolved above.