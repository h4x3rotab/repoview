# Development

This doc collects the “how it works” details so `README.md` can stay product-focused.

## Project layout

- `src/server.js`: Express server + routes (`/tree`, `/blob`, `/raw`, `/events`)
- `src/markdown.js`: Markdown rendering + link/image rewriting + sanitization
- `src/linkcheck.js`: broken-link scanner (Markdown → rendered HTML → internal link validation)
- `src/gitignore.js`: `.gitignore` matcher (used for hiding + scanner noise reduction)
- `src/views.js`: HTML templates (mobile-first top bar + GitHub-style Markdown shell)
- `public/`: CSS + client JS (live reload, KaTeX render, Mermaid render, query preservation)

## Running locally

```bash
npm install
npm start -- --repo /path/to/repo --port 3000
```

Useful flags:
- `--watch` / `--no-watch` (watch is on by default)
- `--host 127.0.0.1` to bind locally only

## Routes

- `GET /tree/<path>`: directory listing (applies `.gitignore` by default; `?ignored=1` shows ignored)
- `GET /blob/<path>`: file view (Markdown rendered; non-Markdown shown as highlighted text)
- `GET /raw/<path>`: raw bytes (used for images and downloads)
- `GET /events`: Server-Sent Events stream for live reload
- `GET /broken-links`: HTML report for broken internal links (Markdown docs)
- `GET /broken-links.json`: report state + raw results

## Link rewriting rules

`src/markdown.js` rewrites relative Markdown links so they stay inside the repo UI:

- Links → `/blob/<path>` (or `/tree/<path>` when the link ends with `/`)
- Images → `/raw/<path>`
- Same rewriting is applied to HTML inside Markdown (`<a href>`, `<img src>`) after sanitization.
- Paths that would escape the repo root (leading `../`) are clamped to the repo root (GitHub-like).
- Already-internal links (`/blob/…`, `/tree/…`, `/raw/…`, `/static/…`) are not rewritten again.

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
npm run lint
```

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
node ./node_modules/.bin/repoview --repo /path/to/repo --port 3000
```
