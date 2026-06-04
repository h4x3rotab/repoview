# Shared multi-repo session ("tmux for repoview")

Status: **implemented** in 0.6.0 (`src/session.ts`, `src/api.ts`, `/r/:repoId`
routing). The prep refactor and TypeScript migration landed first — see
[Prep refactor](#prep-refactor).

## Goal

Let multiple `npx repoview` invocations join a single running session instead of
each one starting its own server on a port the user has to remember. The first run
starts the daemon; subsequent runs register their repo with the existing daemon and
exit. Repos are managed from the CLI or switched in the frontend.

### Requirements

- Shared instance like tmux: multiple `npx repoview` runs join one session.
- No need to remember a port per instance.
- A session is keyed by the listening port (backwards compatible — `--port` still
  starts an independent session).
- A second run targeting the same session does **not** block: it registers its repo
  in the existing session and exits.
- Repos can be managed from the CLI **and** the frontend.
- The frontend can switch between open repos easily.

## Design

### 1. Session = daemon on a port

A *session* is one daemon process owning a port (default 7376). It holds N
registered repos in memory as a `Map<repoId, RepoContext>` plus an
insertion-ordered list (first = the "default" repo; also the switcher order).

`repoview` (in a dir) first **tries to join** the daemon on the target port; if
none is running it **becomes** the daemon and registers its cwd.

Join handshake:

1. `GET /api/session`.
   - Returns the repoview signature → `POST /api/repos {path, watch}`, print the
     repo's URL, **exit immediately** (non-blocking).
   - Connection refused → we are first: `listen()`. On `EADDRINUSE` (race with
     another starting process) → fall back to the join path.
   - Port answers but is **not** repoview → error: pick another `--port`.
2. Join is idempotent: registering an already-registered realpath returns the
   existing repo (prints URL, exits).

`--port` gives fully independent sessions → backwards compatible.

### 2. URL scheme — repo-prefixed

Every per-repo route lives under `/r/:repoId/…`:

```
/r/<id>/tree/*      /r/<id>/blob/*     /r/<id>/raw/*
/r/<id>/diff        /r/<id>/review/*   /r/<id>/events
/r/<id>/rev         /r/<id>/broken-links[.json]
/r/<id>/api/code-context
```

Each repo is fully isolated and bookmarkable. Legacy paths (`/`, `/tree/*`,
`/blob/*`, `/diff`, `/review*`, `/raw/*`) **redirect to the default (first) repo**
for backwards compatibility.

`repoId` = slugified dir basename; on collision with a *different* path, append
`-2`, `-3`, …. Stable within a session.

### 3. Per-repo context

`startServer` becomes `createSession`. Each `RepoContext` owns its own
`gitInfo`, `ignoreMatcher`, `linkScanner`, `reviewDir`, **its own chokidar watcher
and reload hub** (a change in repo A only live-reloads repo A's pages). The
markdown renderer is stateless and process-global; so are the vendor static mounts.

### 4. Control API (loopback-guarded for mutations)

| Method | Path                | Notes                                    |
|--------|---------------------|------------------------------------------|
| GET    | `/api/session`      | Signature + repo list (used for join)    |
| GET    | `/api/repos`        | List repos                               |
| POST   | `/api/repos`        | Register `{path, watch}` (idempotent)    |
| DELETE | `/api/repos/:id`    | Unregister + stop its watcher            |
| POST   | `/api/shutdown`     | Graceful stop                            |

The daemon already serves file contents to the bind host, so letting *anyone on
the network* register an arbitrary host path is a privilege escalation. Mutating
endpoints (`POST`/`DELETE`/`shutdown`) are restricted to **loopback**
(`req.socket.remoteAddress` ∈ `127.0.0.1`, `::1`, `::ffff:127.0.0.1`). Local CLI
joins are loopback, so this is transparent. Helpers live in `src/net.ts`.

Because a session binds `0.0.0.0` by default and exposes *every* added repo to
the network, the server prints a **warning at startup** when bound to a
non-loopback host, and the `/session` page renders **read-only** for non-loopback
viewers (`canManage` is false — no add/remove controls, no `session.js`).

### 5. CLI surface

```
repoview                 start/join + register cwd (default)
repoview ls              list repos in the session
repoview rm <id|path>    unregister a repo
repoview stop            shut the daemon down
repoview review …        unchanged (pure filesystem)
```

### 6. Frontend

- Topbar **repo switcher** dropdown listing all repos (current marked), each
  linking to `/r/<id>/tree/`, plus a **Manage repos…** entry.
- A **session page** at `/session` lists every repo (open / remove) and has an
  add-repo form — both call the loopback-guarded control API, so repos can be
  managed entirely from the browser. Unknown/removed repo URLs fall back to this
  page (404) instead of a bare error.
- `views.js`: thread a `repoBase = /r/<id>` prefix through breadcrumbs, brand link,
  diff/review/broken-links/toggle hrefs; expose it to the client via
  `<body data-repo-base>`.
- `app.js` / `review.js`: prefix SSE (`/r/<id>/events`), `/rev`, broken-links, and
  review API calls with `repoBase`.

### 7. Out of scope (v1)

Disk persistence across daemon restart (state dies with the server, like tmux);
auth beyond the loopback guard; registering remote repos.

## Testing

End-to-end coverage uses the **Chrome DevTools MCP** (browser automation) rather
than the legacy Playwright suite for the new flows — drive a real Chrome via the
MCP tools to:

- start a session, register a second repo via a second CLI invocation, and assert
  it exits without blocking;
- exercise the topbar repo switcher and confirm navigation between `/r/<id>/…`;
- verify per-repo live reload (a change in repo A reloads only repo A's pages);
- check `ls` / `rm` reflect in the frontend switcher.

Unit/lint coverage stays via `npm run lint`.

## Prep refactor

Before the feature, `src/server.js` (one 1100-line `startServer` closing over all
per-repo state) is restructured so the multi-repo step is mechanical:

1. Extract pure helpers into modules (`git`, `paths`, `format`, `csv`, `reload`).
2. Introduce a `RepoContext` object bundling per-repo state; route handlers take
   `ctx` instead of closure variables.
3. Build per-repo routes via a `createRepoRouter(ctx)` factory (mounted at `/` for
   single-repo today, at `/r/:repoId` once multi-repo lands).

The refactor is behavior-preserving and verified with the existing test suite.
</content>
</invoke>
