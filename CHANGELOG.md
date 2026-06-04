# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.6.0 (unreleased)

### Added
- **Shared multi-repo sessions (tmux-style).** Multiple `repoview` invocations on
  the same port now join one server instead of each starting its own. The first
  run starts the daemon; later runs register their repo and exit immediately — no
  more remembering a port per repo. Each repo is served at `/r/<id>/…`.
- **Repo switcher** in the topbar and a **`/session` management page** to open,
  add, and remove repos from the browser.
- **CLI session commands:** `repoview ls`, `repoview rm <id|path>`, `repoview stop`.
- **Control API:** `GET /api/session`, `GET/POST /api/repos`,
  `DELETE /api/repos/:id`, `POST /api/shutdown` (mutations restricted to loopback).
- HTTP integration test suite (`npm test`, `node:test`) — runs without a browser.

### Changed
- **Default port is now `7376`** ("REPO" on a phone keypad) instead of `3000`, to
  avoid colliding with common dev servers. Override with `--port` or `$PORT`.
- **Migrated the codebase to TypeScript** (strict). Sources compile to `dist/`;
  the published package ships `dist/` and `bin` points at `dist/cli.js`.
- `startServer` was refactored into a session + per-repo context/router design;
  each repo owns its own git info, gitignore matcher, link scanner, reload hub,
  and file watcher.
- Playwright moved to `npm run test:e2e`; `npm test` is the browser-free suite.

### Security
- The session binds `0.0.0.0` by default, exposing every added repo to the
  network. The server now **warns at startup** when bound to a non-loopback host,
  and the `/session` page is **read-only** for non-loopback viewers. Use
  `--host 127.0.0.1` to keep a session fully local.

### Fixed
- Markdown content links are prefixed with the repo base exactly once (guards a
  double-rewrite during sanitization).
- Repo switcher dropdown stays on-screen on narrow viewports (left-anchored).

### Upgrade notes (0.5.x → 0.6.0)
- **Default port changed** from `3000` to `7376`. If you relied on the old
  default, pass `--port 3000` (or set `$PORT`).
- **URLs are now repo-prefixed** (`/r/<id>/…`). Old bookmarks to `/tree/…`,
  `/blob/…`, etc. still work — they redirect to the default repo — but the
  canonical URL now includes the repo id.
- No data migration is needed; review threads under `.repoview/` are unchanged.

## 0.5.1

- Render Markdown frontmatter as a styled header.
- Inline code review threads; Playwright end-to-end suite.
</content>
