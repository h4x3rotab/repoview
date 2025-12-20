# repoview

GitHub-like repo browsing — without GitHub.

When platforms change pricing/terms (even for “bring-your-own-runner” CI), it’s a reminder that Git hosting can turn into a dependency and a risk. `repoview` keeps the day-to-day “GitHub UI” experience local: browse, read docs, and share a repo without pushing it anywhere.

## What it does
- Browse any local repo like GitHub (tree / file views)
- Render Markdown in GitHub style (README-friendly, close-to-GitHub)
- Auto-refresh when files change (great for docs)
- Find broken internal links in your docs (report page)
- Hide `.gitignore`d files by default (toggleable)

Not affiliated with GitHub.

## Quick start (from source)

```bash
npm install
npm start -- --repo /path/to/your/repo --port 3000
```

Then open `http://localhost:3000`.

## Why

- Keep GitHub as a remote, not your developer portal.
- Share private repos/docs on a LAN without pushing or mirroring.
- Work offline / in restricted networks with the same browsing UX.

## Usage

```bash
npm start -- --repo /path/to/repo [--host 127.0.0.1] [--port 3000] [--no-watch]
```

Common flags:
- `--repo`: repo root
- `--host`, `--port`: bind address/port
- `--no-watch`: disable live reload + auto re-scan

Docs:
- `--help` for full CLI help
- `DEVELOPMENT.md` for implementation details
- `CONTRIBUTING.md` for contributing

## Share on LAN (optional)

Bind to all interfaces, then open the host URL from another device:

```bash
npm start -- --repo /path/to/repo --host 0.0.0.0 --port 8890
```
