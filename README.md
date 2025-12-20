# repo-viewer

Serve a local Git repository as a GitHub-like website (no GitHub required):

- Browse directories and files (`tree`/`blob`/`raw`)
- Render Markdown with GitHub-style CSS (close-to-GitHub, not byte-identical)
- Live reload in the browser when files change (auto refresh)

## Quick start

```bash
npm install
npm start -- --repo /path/to/your/repo --port 3000
```

Then open `http://localhost:3000`.

## CLI

```bash
npm start -- --repo /path/to/repo [--host 127.0.0.1] [--port 3000] [--no-watch]
```

Options:
- `--help`, `-h`: show help
- `--repo`: path to the repository root (required)
- `--host`: bind address (default: `127.0.0.1`)
- `--port`: bind port (default: `3000`)
- `--no-watch`: disable filesystem watching + browser auto-refresh (watch is on by default)

Environment variables:
- `REPO_ROOT`, `HOST`, `PORT`

## URL structure

- `GET /` → redirects to `GET /tree/`
- `GET /tree/<path>` → directory listing
- `GET /blob/<path>` → file viewer (Markdown rendered; other files shown as highlighted text)
- `GET /raw/<path>` → raw file bytes (used for images/assets in Markdown)

## Live reload

When watch is enabled, the server watches the repo (excluding `.git/` and `node_modules/`) and pushes a reload event to the browser via Server-Sent Events:
- `GET /events` (SSE stream)

Client-side reload can be disabled per-tab with `?watch=0` in the URL.

## Broken link scanning

On startup (and on filesystem changes when watch is enabled), the server scans Markdown files, renders them, and verifies that generated internal links resolve to files/directories inside the repo.

- `GET /broken-links` (HTML report)
- `GET /broken-links.json` (machine-readable)

## Markdown support (close to GitHub)

Rendering is done with `markdown-it` plus targeted plugins and post-processing to feel GitHub-like.

Implemented features:
- GitHub-style rendering via `github-markdown-css`
- Tables, strikethrough, autolinkification
- Task lists (`- [x]`) with non-interactive checkboxes
- Footnotes (`[^1]`)
- Emoji shortcodes (e.g. `:smile:`)
- GitHub-style callouts/alerts:
  - `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`
- Math via KaTeX auto-render (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`)
- Mermaid diagrams via fenced blocks (` ```mermaid `)
- Common README HTML like `<details>` is allowed, but sanitized

Relative link handling:
- Relative Markdown links are rewritten to stay within the repo.
  - Example: from `docs/README.md`, `[Intro](intro.md)` → `/blob/docs/intro.md`
  - Root-relative: `[Intro](/docs/intro.md)` → `/blob/docs/intro.md`
- Relative images are rewritten to `/raw/...` so assets load correctly.
- For HTML inside Markdown (`<a href=...>`, `<img src=...>`), the same rewriting is applied after sanitization.

Security:
- Rendered HTML is sanitized to drop dangerous tags/attributes (e.g. inline event handlers).

Known gaps vs GitHub:
- GitHub uses `cmark-gfm` with additional GitHub-specific processing; edge-case parsing can differ.
- Already percent-encoded paths in links (e.g. `my%20file.md`) may be double-encoded.
- No issue/PR/user reference linking (by design).
