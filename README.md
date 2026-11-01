# Idolytics

K-pop performance analytics — a local-first React app for planning stages and tracking how a group's performances add up.

## Features

- **Workspaces, groups & songs** — organize projects around the groups and songs you're analyzing.
- **Choreo editor** — map formations on a stage grid across song sections, with member placements, postures, and anchor positions.
- **Line distribution** — capture sung and ad-lib lines and see the distribution visualized per member.
- **Scoring & leaderboards** — score formations against live criteria, review results, and compare performances.
- **Project media library** — in local development, linked audio and video are copied into `media/groups/<Group>/songs/<Song>` so songs reopen without re-linking.
- **URL imports** — paste a supported video or audio link to download it with yt-dlp directly into the song's media folder.
- **Song link lookup** — paste a link in the song dialog to fill in the exact song length; the link is saved and pre-filled for audio import.
- **Local-first data** — the workspace is persisted in IndexedDB, with import/export, undo/redo, and schema migrations.

## Tech stack

- [React 19](https://react.dev/) + TypeScript
- [Vite](https://vite.dev/) for dev server and builds
- [Zustand](https://zustand.docs.pmnd.rs/) for state management
- [Zod](https://zod.dev/) for runtime data validation
- [idb-keyval](https://github.com/jakearchibald/idb-keyval) for IndexedDB persistence
- [Vitest](https://vitest.dev/) for unit tests

## Getting started

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. The dev server is pinned to that origin and refuses to start if port 3000 is already in use. Do not switch to another port or `127.0.0.1` for real work: IndexedDB and the rest of browser storage are scoped to the exact origin, so another address is a separate, empty workspace. `npm run preview` uses `http://localhost:4173` for production-build checks only.

## Dev origin and workspace backups

In development, the app writes JSON workspace snapshots to `backups/workspace/` through a local dev-server endpoint. They survive origin changes, browser-profile changes, cleared site data, and accidental resets because they are stored on disk rather than in the browser.

- A non-empty workspace is backed up after about five seconds of idle, at most once per minute.
- **Settings → Data → Back up now** creates a snapshot on demand.
- A safety snapshot is written before resetting, importing, or restoring a workspace. If the backup service is unavailable, the destructive action is blocked.
- The newest 20 snapshots are kept and identical snapshots are deduplicated.
- **Settings → Data** lists snapshots and can restore one. Restores are validated with the workspace schema and integrity checks first.
- If the app opens with an empty workspace or unreadable saved data and a backup exists, a recovery banner offers the newest snapshot.
- A wrong-origin banner appears in development when the app is opened on any URL other than `http://localhost:3000`. Local backups are shared across ports, so they can still be restored from the wrong origin.

The `backups/` folder is excluded from Git. It is a local safety net, not a replacement for **Export JSON**: keep occasional manual exports somewhere outside the project too. Backups run only through the dev server; production builds and previews use IndexedDB and manual exports.

## Local media library

When the app runs through `npm run dev`, linking audio or video copies the file into the project's `media/` folder and records it in `media/.idolytics-media.json`. Group and song folders follow the names in your workspace, so renaming either one moves the folder. Files are copied, never moved, and deleting a group or song leaves its media in place.

Auto-copy is on by default and can be turned off in **Settings → Media**. Production builds and previews use the normal re-link flow instead. The `media/` contents are excluded from Git; see [`media/README.md`](media/README.md) for the folder layout.

## URL imports

In development, the video and audio panels can download a supported link straight into the song's media folder instead of asking you for a file. Imports run locally through [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) and need [ffmpeg](https://ffmpeg.org/download.html) to finish the file.

1. Install `yt-dlp` and `ffmpeg` so both commands work in a terminal.
2. Start the app with `npm run dev`.
3. Open a song, choose **Import URL** in the video or audio panel, paste a link, and start the import.

The **Add song** and **Edit song** dialogs can also read a link without downloading it. Pasting a supported URL fills the song length with yt-dlp metadata, and the link is saved on the song so **Import song audio** can pre-fill it later. This lookup needs `yt-dlp` but not `ffmpeg`.

Video imports default to **1080p**, with **720p** and **Best** available in the import dialog. The choice is remembered in this browser. Video and song audio are imported separately on purpose: a choreo video's audio is usually a different mix, so the app never extracts audio from an imported video.

Playlist, live, local-network, and private-host links are rejected. Downloads are written to `media/.tmp/` and committed through the normal media manifest, so they auto-load on reload and follow group/song renames like any other library file.

### Missing tools or blocked downloads

Both tools are discovered on `PATH`. You can override the binaries before starting the dev server:

```bash
# PowerShell examples; use your shell's syntax elsewhere
$env:IDOLYTICS_YTDLP_PATH = "C:\tools\yt-dlp.exe"
$env:IDOLYTICS_FFMPEG_PATH = "C:\tools\ffmpeg.exe"
npm run dev
```

When a site asks for a sign-in (YouTube bot checks, age-restricted videos, members-only posts), point yt-dlp at browser cookies. Either export cookies from a signed-in browser and set a file:

```bash
$env:IDOLYTICS_YTDLP_COOKIES_FILE = "C:\path\to\cookies.txt"
```

or read them directly from a local browser profile:

```bash
$env:IDOLYTICS_YTDLP_COOKIES_FROM_BROWSER = "chrome"
```

Restart the dev server after changing any of these variables. Cookies can contain account credentials; keep the file out of the project and out of Git.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check without emitting |
