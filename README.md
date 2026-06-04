# repoview

GitHub-like repo browsing — without GitHub.

When platforms change pricing/terms (even for “bring-your-own-runner” CI), it’s a reminder that Git hosting can turn into a dependency and a risk. `repoview` keeps the day-to-day “GitHub UI” experience local: browse, read docs, and share a repo without pushing it anywhere.

Not affiliated with GitHub.

## Features

- GitHub-like browsing for local repos (tree / file / raw views)
- GitHub-style Markdown rendering (README-friendly; close-to-GitHub)
- Diff view — browse uncommitted changes against HEAD, branches, or tags (`/diff`)
- Live reload when files change (SSE with polling fallback)
- Broken internal link discovery for docs (`/broken-links`)
- Respects `.gitignore` by default (toggleable)
- Shared sessions (like tmux): run `repoview` in several repos on the same port and browse them all from one server, switching between them in the UI

## Quick start (from source)

```bash
npm install
npm start -- --repo /path/to/your/repo --port 3000
```

Then open `http://localhost:3000`.

## Quick start (npx)

From anywhere:

```bash
npx repoview --repo /path/to/your/repo --port 3000
```

By default, `repoview` binds to `0.0.0.0` (LAN-accessible). For localhost-only:

```bash
npx repoview --repo /path/to/your/repo --host 127.0.0.1 --port 3000
```

## Shared sessions (multi-repo)

The first `repoview` on a port starts a server; later runs on the **same port**
join it instead of failing — they register their repo and exit immediately
(no need to remember a port per repo):

```bash
cd ~/work/api    && repoview            # starts the session on :3000
cd ~/work/web    && repoview            # joins :3000, registers, exits
cd ~/work/docs   && repoview            # joins :3000, registers, exits
```

Each repo is served at `/r/<id>/…`; switch between them from the dropdown in the
top bar, or open **Manage repos…** (the `/session` page) to add/remove repos
from the browser. Manage the session from the CLI too:

```bash
repoview ls                 # list repos in the session
repoview rm <id|path>       # unregister a repo
repoview stop               # shut the session down
```

Use `--port` to run independent sessions side by side. Session control endpoints
(register / remove / stop) are restricted to localhost.

## Why

- Keep GitHub as a remote, not your developer portal.
- Share private repos/docs on a LAN without pushing or mirroring.
- Work offline / in restricted networks with the same browsing UX.

## Usage

```bash
npm start -- [--repo /path/to/repo] [--host 0.0.0.0] [--port 3000] [--no-watch]
```

Common flags:
- `--repo`: repo root
- `--host`, `--port`: bind address/port
- `--no-watch`: disable live reload + auto re-scan

## Share on LAN (optional)

Bind to all interfaces, then open the host URL from another device:

```bash
npm start -- --repo /path/to/repo --host 0.0.0.0 --port 8890
```

## Diff view

Navigate to `/diff` (or click the "Diff" link in the top bar) to see uncommitted changes. Use the dropdown to compare against HEAD, a branch, or a tag. File sections are collapsible — click a file header to collapse/expand.

## UI toggles

- `?ignored=1` shows files ignored by the repo's `.gitignore` (default: hidden)
- `?watch=0` disables browser auto-refresh for that tab
- `?base=<ref>` selects the diff comparison base (default: `HEAD`)

## Development

- Implementation details: [`DEVELOPMENT.md`](DEVELOPMENT.md)
- CLI usage: `npm start -- --help`

## Troubleshooting

- Seeing `ENOENT .../node_modules/...` in server logs: upgrade to `repoview@>=0.1.2` (older versions incorrectly looked for vendor assets inside the repo you’re serving).

## Contributing

- Contributing guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## License

MIT — see [`LICENSE`](LICENSE).
