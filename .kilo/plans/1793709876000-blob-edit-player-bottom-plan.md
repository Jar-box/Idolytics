# Plan: blob click-to-edit + bottom player bar

## Context
- Line page: `src/features/lines/LineDistributionPanel.tsx`. Layout: `.line-page` > `.line-layout` (`.line-main` + `.line-sidebar`), CSS `styles.css:5118-5148`.
- Blob = `.dist-segment` in `DistributionChart.tsx:327`. Click today → `onSelectLine(id)` + `onSeek` (select only). Log row click → `onSelect(id)` + select only; Pencil icon → `onEdit(line)` enters edit.
- Details/edit container = `LineCaptureForm` (`line-capture-panel`), driven by `editingLineId` state (`LineDistributionPanel.tsx:56`). Player = `AudioPanel` (`audio-panel`), first child of `.line-sidebar`.

## Decisions (confirmed with user)
- Clicking a dist segment **or** log row → select + seek + **edit** (`editingLineId = line.id`). Pencil remains a secondary edit entry.
- Click outside → exit editing (draft discarded silently + "Changes discarded" toast). Exempt from exit: `.line-capture-panel`, `.audio-panel`. Clicking another `.dist-segment`/`.line-log-row` **switches** the edit target instead of exiting. **Escape** also exits editing.
- Player moved to a fixed bottom bar (Spotify/Apple Music style), contained width, playback-focused; page/sidebar get bottom padding so the Save/Add button stays reachable; toasts shifted up to avoid collision.

## Affected files
1. `src/features/lines/LineDistributionPanel.tsx` — edit-on-click handlers, document click/Escape exit listener, move AudioPanel out of sidebar.
2. `src/features/lines/DistributionChart.tsx` — no change (parent wraps `onSelectLine`).
3. `src/features/lines/LineLog.tsx` — no change (parent wraps `onSelect`).
4. `src/features/lines/LineCaptureForm.tsx` — no change.
5. `src/features/lines/AudioPanel.tsx` — no change (moves in DOM only).
6. `src/styles.css` — bottom player bar, sidebar max-height, line-page padding-bottom, toast viewport offset.

## Tasks
1. `LineDistributionPanel.tsx`: replace `onSelectLine={setSelectedLineId}` with a handler that also calls `setEditingLineId(id)`; wrap LineLog `onSelect` the same way (`setSelectedLineId(id); setEditingLineId(id)`).
2. `LineDistributionPanel.tsx`: add `useEffect` with a document `mousedown` listener — if `!event.target.closest('.dist-segment, .line-log-row, .line-capture-panel, .audio-panel')` then `setEditingLineId(null)`; add `keydown` Escape listener doing the same. (Excluding `.line-log-row` whole row — not just `.line-log-main` — prevents the Pencil/trash/seek icons from clearing the edit just before their own handlers run.)
3. `LineDistributionPanel.tsx`: move `<AudioPanel>` out of `.line-sidebar` to after `.line-layout` inside `.line-page`, classed `audio-player-bottom`; sidebar keeps only `LineCaptureForm`.
4. `styles.css`:
   - `.audio-player-bottom`: `position: fixed; bottom: 0; left: 50%; translateX(-50%); width: min(100%, 1560px); height: ~104px; border-top; shadow; z-index above header (40) and below/clear of toasts`, inner padding; playback controls prominent, keep link/relink accessible.
   - `.line-sidebar`: `max-height: calc(100vh - 98px - <player height + gap>)` so scrollable content isn't hidden behind the bar.
   - `.line-page`: `padding-bottom: 128px`.
   - `.toast-viewport`: `bottom: calc(104px + 22px)`.
   - Re-check `@media (max-width: 1100px)` sidebar override (`order: -1`, static) still works with the fixed bar.
5. Verify: `npm run typecheck`, `npm test`, `npm run build`.
6. Manual checks: blob click → form "Edit part" prefilled; outside click → "Capture a part" empty + discard toast; mid-edit different blob → target switches, no exit; Escape exits; Save clears editing, keeps selection; bottom player visible and Save/Add button reachable without scrolling.

## Risks / failure modes
- Pencil/trash/seek icons inside a log row clearing edit before their handler runs — mitigated by excluding `.line-log-row`, not just `.line-log-main`.
- Clicking the sidebar scrollbar exits edit — accepted edge case.
- Fixed player overlapping toasts on narrow viewports — mitigated by toast `bottom` offset.
- Draft reset when `line` prop goes null — existing `activeLineId`-keyed `useEffect` in `LineCaptureForm.tsx:75` already handles it.
