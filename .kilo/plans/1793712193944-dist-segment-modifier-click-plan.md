# Plan: Modifier-click to avoid seeking on distribution segment

## Goal
Clicking a distribution segment normally selects the line and seeks the playhead to the segment start. Allow holding a modifier key (Ctrl/Cmd) while clicking to select the line without moving the playhead.

## Affected code
- `src/features/lines/DistributionChart.tsx` — segment `<button>` `onClick` handler (around line 354).

## Change
In the onClick handler, keep `onSelectLine(line.id)` always, but only call `onSeek(line.startSec)` when no modifier key is pressed (`!(event.ctrlKey || event.metaKey)`).

## Validation
- Manual: click segment → playhead moves to start; Ctrl/Cmd-click → selection changes but playhead stays.
- Run existing tests for DistributionChart if any.
