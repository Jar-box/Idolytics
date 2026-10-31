# Idolytics

K-pop performance analytics — a local-first React app for planning stages and tracking how a group's performances add up.

## Features

- **Workspaces, groups & songs** — organize projects around the groups and songs you're analyzing.
- **Choreo editor** — map formations on a stage grid across song sections, with member placements, postures, and anchor positions.
- **Line distribution** — capture sung and ad-lib lines and see the distribution visualized per member.
- **Scoring & leaderboards** — score formations against live criteria, review results, and compare performances.
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

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check without emitting |
