# Development

This doc collects the “how it works” details so `README.md` can stay product-focused.

## Project layout

- `src/server.ts`: Express app wiring — vendor static mounts, the control API, the `/r/:repoId` repos router, the `/session` page, and legacy redirects
- `src/session.ts`: a session owning multiple repos (add/remove/list, slug ids, default repo)
- `src/api.ts`: control API router (`/api/session`, `/api/repos`, `/api/shutdown`); mutations loopback-guarded
- `src/repo-context.ts`: per-repo runtime state (git info, gitignore matcher, link scanner, reload hub, file watcher)
- `src/repo-router.ts`: the per-repo routes (`/tree`, `/blob`, `/raw`, `/diff`, `/review`, `/events`, …) as a router that resolves `/r/:repoId` → a per-repo child router
- `src/net.ts`: loopback helpers (control-endpoint guard, bind-host check)
- `src/types.ts`: shared interfaces (`RepoContext`, `Session`/`RepoSummary`, `GitInfo`, `MarkdownRenderer`, `LinkScanner`, …)
- `src/git.ts` / `src/paths.ts` / `src/format.ts` / `src/csv.ts` / `src/reload.ts`: extracted helpers (git CLI, path safety, byte/date formatting, CSV parsing, SSE reload hub)
- `src/markdown.ts`: Markdown rendering + link/image rewriting (repo-prefixed) + sanitization
- `src/linkcheck.ts`: broken-link scanner (Markdown → rendered HTML → internal link validation)
- `src/gitignore.ts`: `.gitignore` matcher (used for hiding + scanner noise reduction)
- `src/views.ts`: HTML templates (mobile-first top bar + repo switcher + GitHub-style Markdown shell)
- `public/`: CSS + client JS (live reload, KaTeX render, Mermaid render, diff collapse, query preservation, session management)

> See `docs/multi-repo-session.md` for the full multi-repo session design.

## TypeScript

The source is TypeScript (`src/*.ts`, `strict` mode). It compiles to `dist/` via
`tsc` and the published package ships `dist/` (the `bin` points at `dist/cli.js`).

```bash
npm run build      # tsc → dist/
npm run lint       # tsc --noEmit (type-check only)
```

`dist/` is git-ignored and rebuilt on `prepack` (so `npm pack` / `npm publish`
always ship a fresh build).

## Running locally

```bash
npm install
npm start -- --repo /path/to/repo --port 7376   # runs src via tsx (no build needed)
# or, after a build:
node dist/cli.js --repo /path/to/repo --port 7376
```

`npm start` / `npm run dev` use `tsx` to run the TypeScript directly for fast
iteration; `npm run build` produces the runnable `dist/` for publishing.

Useful flags:
- `--watch` / `--no-watch` (watch is on by default)
- `--host 127.0.0.1` to bind locally only

## Routes

Every repo is served behind a `/r/<id>` prefix (the repo's slug id). Legacy
non-prefixed paths (`/`, `/tree`, `/blob`, `/raw`, `/diff`, `/review`,
`/broken-links`, `/events`, `/rev`) redirect to the default (first) repo.

Per-repo routes (under `/r/<id>`):
- `GET /tree/<path>`: directory listing (applies `.gitignore` by default; `?ignored=1` shows ignored)
- `GET /blob/<path>`: file view (Markdown rendered; non-Markdown shown as highlighted text)
- `GET /raw/<path>`: raw bytes (used for images and downloads)
- `GET /events`: Server-Sent Events stream for live reload (`GET /rev` is the polling fallback)
- `GET /diff`: diff view — compare working tree against a base ref (`?base=HEAD` default; accepts branches, tags)
- `GET /review/…`: code review threads
- `GET /broken-links[.json]`: broken internal link report

Session-level routes:
- `GET /session`: manage repos (open / add / remove); read-only for non-loopback clients
- `GET /api/session`: session signature + repo list (also the join handshake)
- `GET /api/repos`, `POST /api/repos`, `DELETE /api/repos/:id`, `POST /api/shutdown`: control API (mutations are loopback-only)

## Link rewriting rules

`src/markdown.ts` rewrites relative Markdown links so they stay inside the repo UI:

- Links → `<repoBase>/blob/<path>` (or `<repoBase>/tree/<path>` when the link ends with `/`), where `repoBase` is `/r/<id>`
- Images → `<repoBase>/raw/<path>`
- Same rewriting is applied to HTML inside Markdown (`<a href>`, `<img src>`) after sanitization.
- Paths that would escape the repo root (leading `../`) are clamped to the repo root (GitHub-like).
- Already-internal links (`/blob/…`, `/tree/…`, `/raw/…`, `/static/…`, and anything already under `repoBase`) are not rewritten again.

## Markdown “GitHub-like” features

The renderer is not `cmark-gfm`, but aims to be “close enough” for typical README/docs:

- Tables, strikethrough, autolinks
- Task lists (`- [x]`)
- Footnotes
- Emoji shortcodes (`:smile:`)
- Callouts (`> [!NOTE]`, `> [!TIP]`, …)
- Math (KaTeX auto-render on the client)
- Mermaid fenced blocks

## Broken link scanning

The scanner renders Markdown, extracts internal `href/src` links, and validates that the referenced repo paths exist.

Notes:
- `.gitignore`d files are hidden by default and are also skipped by the scanner (to reduce noise).
- The scanner runs at startup and re-runs on filesystem changes when watch is enabled.

## Lint

```bash
npm run lint   # tsc --noEmit — full strict type-check
```

## Tests

```bash
npm test        # build + node:test HTTP integration suite (no browser needed)
npm run test:e2e   # Playwright browser suite (requires installed browsers)
```

- `tests/integration/*.test.mjs` boots the server in-process (from `dist/`) and
  drives it over HTTP — covering the session API, `/r/<id>` routing, legacy
  redirects, repo registration/idempotency/slug-disambiguation, the session
  page, and the unknown-repo fallback. This is the default `npm test` and runs
  anywhere.
- The Playwright suite (`tests/frontend.spec.js`) covers the rich browsing/review
  UI in a real browser; it needs `npx playwright install` and is run as
  `test:e2e`. New multi-repo flows are exercised via the Chrome DevTools MCP
  (see `docs/multi-repo-session.md`).

## Release checklist

Before publishing to npm, run a quick smoke test from a clean install context (this catches issues where the server accidentally serves assets from the *repo* instead of the installed package):

```bash
npm run lint
npm pack

# install the tarball somewhere else
tmp=$(mktemp -d)
cd "$tmp"
npm init -y
npm install /path/to/repoview-*.tgz

# serve any repo and verify vendor assets load (no ENOENT)
node ./node_modules/.bin/repoview --repo /path/to/repo --port 7376
```
