#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { startServer } from "./server.js";
import { handleReviewCommand } from "./review-cli.js";
import type { RepoSummary } from "./types.js";

function printHelp() {
  // Keep this in sync with README.md
  process.stdout.write(`repoview — browse local Git repos as a GitHub-like website, and publish
ephemeral file previews ("gists"). Built to be driven by humans and agents.

SESSION MODEL (like tmux)
  Invocations on the same port share ONE session (daemon). The FIRST run starts
  the daemon and KEEPS RUNNING in the foreground (it is the server). LATER runs
  on that port just register their repo and exit 0 immediately. So you never have
  to remember a port per repo. Each repo is served at /r/<id>/...
  Default port: 7376. Use --port for independent sessions.
  Agent tip: background the first run (e.g. \`repoview … &\` or nohup); once it
  prints "listening:", the daemon is up and all other commands below will work.

START / JOIN A SESSION
  repoview [--repo PATH] [--host HOST] [--port N] [--no-watch]
    If no daemon is on --port: becomes the daemon (blocks/foreground).
    If a daemon is already there: registers the repo, prints its URL, exits 0.

  Options:
    --repo <path>   Repo root (default: $REPO_ROOT or current dir)
    --host <host>   Bind address (default: 0.0.0.0; use 127.0.0.1 for local-only)
    --port <port>   Session port (default: 7376)
    --no-watch      Disable live reload for this repo
    -h, --help      Show this help

MANAGE THE SESSION (require a running daemon on --port)
  repoview ls                 List repos: "<id> <branch> <path>" + each URL
  repoview rm <id|path>       Unregister a repo
  repoview stop               Shut the session daemon down

PUBLISH A GIST (ephemeral file preview; default TTL 24h, gone on restart)
  repoview gist <file> [--title "T"] [--ttl 24h] [--filename name.md] [--url URL]
  cat report.md | repoview gist --filename report.md      (reads stdin)
    Needs a running daemon on --port (or use --url for a remote server). Prints
    ONE line: the preview URL. --ttl accepts 30m/24h/7d/seconds (1m–7d).
    Note: --title is the page/list label only; the rendered H1 still comes from
    the file's own first Markdown heading.

CODE REVIEW THREADS (pure filesystem, NO daemon — operate on a repo's .repoview/)
  Add --repo <path> to EVERY review command (default: $REPO_ROOT or cwd — NOT the
  session's served repo). --port/--host are ignored here.
  repoview review new   --repo R --title "Title"               Create (prints id)
  repoview review post  --repo R <id> --role agent --body "…"  Post a message
  repoview review post  --repo R <id> --role agent --file F    Post from file/stdin
  repoview review read  --repo R <id>                          Print thread JSON
  repoview review list  --repo R                               List threads (JSON)

HTTP API (for agents / remote use — base = http://<host>:<port>)
  GET    /api/session            {app, version, repos:[{id,name,path,branch}]}
  GET    /api/repos              {repos:[…]}
  POST   /api/repos              {path, watch?} → {id, url}        (localhost only)
  DELETE /api/repos/:id          → {ok}                           (localhost only)
  POST   /api/shutdown           → {ok}                           (localhost only)
  POST   /api/gists              {content, filename?, title?, ttlSeconds?}
                                 → {id, url, rawUrl, expiresAt}
  Examples:
    curl -s $BASE/api/session
    curl -s -X POST $BASE/api/gists -H 'content-type: application/json' \\
      -d '{"content":"# Hi","filename":"hi.md","ttlSeconds":3600}'

PAGES
  /                 → default repo            /session   manage repos (add/remove)
  /r/<id>/tree/     browse a repo            /gists     list of active gists
  /r/<id>/diff      working-tree diff        /gist/<id> a gist preview (+ /raw)
  /r/<id>/review/   review threads

ENVIRONMENT
  REPO_ROOT          Default repo when --repo is omitted
  HOST, PORT         Default bind host / session port
  REPOVIEW_BASE_URL  Absolute origin used in returned gist URLs. Read by the
                     SERVER/daemon at request time — set it when STARTING the
                     daemon, not on the gist client. Falls back to the request
                     Host header. (e.g. when the server runs remotely)
`);
}

interface ParsedArgs {
  watch: boolean;
  help?: boolean;
  repo?: string;
  port?: number;
  host?: string;
  rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: Omit<ParsedArgs, "rest"> = { watch: true };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "-h" || value === "--help") args.help = true;
    if (value === "--watch") args.watch = true;
    else if (value === "--no-watch") args.watch = false;
    else if (value === "--repo") args.repo = argv[++i];
    else if (value === "--port") args.port = Number(argv[++i]);
    else if (value === "--host") args.host = argv[++i];
    else rest.push(value);
  }
  return { ...args, rest };
}

/** Address to connect to when joining a local daemon (0.0.0.0 isn't routable). */
function connectHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "") return "127.0.0.1";
  return host;
}

interface SessionInfo {
  app?: string;
  version?: string;
  repos?: RepoSummary[];
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof Error && /HTTP \d|error/i.test(e.message) && !/fetch failed|ECONNREFUSED/i.test(e.message)) {
      throw e;
    }
    return null;
  }
}

async function probeSession(base: string): Promise<SessionInfo | null> {
  return (await fetchJson(`${base}/api/session`)) as SessionInfo | null;
}

async function registerRepo(
  base: string,
  repoRoot: string,
  watch: boolean,
): Promise<{ id: string; name: string; url: string }> {
  const result = await fetchJson(`${base}/api/repos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoRoot, watch }),
  });
  if (!result) throw new Error("Failed to register repo with the session");
  return result as { id: string; name: string; url: string };
}

function printRepoTable(repos: RepoSummary[], port: number, host: string) {
  if (!repos.length) {
    process.stdout.write("(no repos registered)\n");
    return;
  }
  const open = connectHost(host);
  for (const r of repos) {
    process.stdout.write(
      `${r.id.padEnd(20)} ${(r.branch || "no-git").padEnd(16)} ${r.path}\n` +
        `${" ".repeat(20)} http://${open}:${port}/r/${r.id}/tree/\n`,
    );
  }
}

async function runSubcommand(
  sub: string,
  args: ParsedArgs,
  base: string,
  port: number,
  host: string,
): Promise<number> {
  if (sub === "ls") {
    const info = await probeSession(base);
    if (!info) {
      process.stderr.write(`No repoview session on ${base}\n`);
      return 1;
    }
    printRepoTable(info.repos || [], port, host);
    return 0;
  }

  if (sub === "stop") {
    const info = await probeSession(base);
    if (!info) {
      process.stderr.write(`No repoview session on ${base}\n`);
      return 1;
    }
    await fetchJson(`${base}/api/shutdown`, { method: "POST" });
    process.stdout.write(`Stopped session on port ${port}\n`);
    return 0;
  }

  if (sub === "rm") {
    const target = args.rest[1];
    if (!target) {
      process.stderr.write("Usage: repoview rm <id|path>\n");
      return 1;
    }
    const info = await probeSession(base);
    if (!info) {
      process.stderr.write(`No repoview session on ${base}\n`);
      return 1;
    }
    const repos = info.repos || [];
    let real = target;
    try {
      real = path.resolve(target);
    } catch {
      // keep as-is
    }
    const match = repos.find((r) => r.id === target || r.path === real || r.path === target);
    if (!match) {
      process.stderr.write(`Repo not found in session: ${target}\n`);
      return 1;
    }
    const res = await fetchJson(`${base}/api/repos/${encodeURIComponent(match.id)}`, {
      method: "DELETE",
    });
    if (!res) {
      process.stderr.write(`Failed to remove ${match.id}\n`);
      return 1;
    }
    process.stdout.write(`Removed ${match.id}\n`);
    return 0;
  }

  process.stderr.write(`Unknown command: ${sub}\n`);
  printHelp();
  return 1;
}

/** Parse "24h" / "30m" / "7d" / "3600" into seconds. */
function parseDuration(text: string): number | undefined {
  const m = String(text).trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return n * mult;
}

async function runGist(restArgs: string[], localBase: string): Promise<number> {
  const flags: { title?: string; ttl?: string; filename?: string; url?: string } = {};
  const positional: string[] = [];
  for (let i = 0; i < restArgs.length; i++) {
    const v = restArgs[i];
    if (v === "--title") flags.title = restArgs[++i];
    else if (v === "--ttl") flags.ttl = restArgs[++i];
    else if (v === "--filename") flags.filename = restArgs[++i];
    else if (v === "--url") flags.url = restArgs[++i];
    else positional.push(v);
  }

  const file = positional[0];
  let content: string;
  if (file) {
    const fs = await import("node:fs/promises");
    content = await fs.readFile(file, "utf8");
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    content = Buffer.concat(chunks).toString("utf8");
  }
  if (!content.trim()) {
    process.stderr.write("Error: no content (pass a file or pipe via stdin)\n");
    return 1;
  }

  const filename = flags.filename || (file ? path.basename(file) : "gist.md");
  let ttlSeconds: number | undefined;
  if (flags.ttl) {
    ttlSeconds = parseDuration(flags.ttl);
    if (ttlSeconds == null) {
      process.stderr.write(`Invalid --ttl: ${flags.ttl} (use e.g. 30m, 24h, 7d)\n`);
      return 1;
    }
  }

  const target = flags.url ? flags.url.replace(/\/+$/, "") : localBase;
  let result: { url?: string } | null;
  try {
    result = (await fetchJson(`${target}/api/gists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, filename, title: flags.title, ttlSeconds }),
    })) as { url?: string } | null;
  } catch (e) {
    process.stderr.write(`Error: ${(e as Error).message}\n`);
    return 1;
  }
  if (!result) {
    process.stderr.write(
      `No repoview session at ${target}. Start one with \`repoview\` first, or pass --url.\n`,
    );
    return 1;
  }
  process.stdout.write(`${result.url}\n`);
  return 0;
}

const parsed = parseArgs(process.argv.slice(2));
const { repo, port: portArg, host: hostArg, watch, help } = parsed;

if (help) {
  printHelp();
  process.exit(0);
}

// Review subcommand (pure filesystem, no daemon).
if (parsed.rest[0] === "review") {
  const repoRootForReview = repo ?? process.env.REPO_ROOT ?? process.cwd();
  await handleReviewCommand(parsed.rest.slice(1), repoRootForReview);
  process.exit(0);
}

if (portArg != null && !Number.isFinite(portArg)) {
  process.stderr.write("Invalid --port value\n");
  process.exit(2);
}

const port = portArg || Number(process.env.PORT) || 7376;
const host = hostArg || process.env.HOST || "0.0.0.0";
const base = `http://${connectHost(host)}:${port}`;

// Session-management subcommands target the running daemon.
if (["ls", "rm", "stop"].includes(parsed.rest[0])) {
  const code = await runSubcommand(parsed.rest[0], parsed, base, port, host);
  process.exit(code);
}

// Publish an ephemeral gist to the session daemon.
if (parsed.rest[0] === "gist") {
  const code = await runGist(parsed.rest.slice(1), base);
  process.exit(code);
}

const repoRoot = repo ?? process.env.REPO_ROOT ?? process.cwd();
const repoRootAbs = path.resolve(repoRoot);

async function joinExisting(): Promise<boolean> {
  const info = await probeSession(base);
  if (!info) return false;
  if (info.app !== "repoview") {
    process.stderr.write(
      `Port ${port} is in use by something that isn't repoview. Use --port to pick another.\n`,
    );
    process.exit(1);
  }
  const registered = await registerRepo(base, repoRootAbs, watch);
  process.stdout.write(
    `Joined repoview session on port ${port}\n` +
      `${registered.name} → http://${connectHost(host)}:${port}${registered.url}\n`,
  );
  return true;
}

// Try to join an existing session first; otherwise become the daemon.
if (await joinExisting()) {
  process.exit(0);
}

try {
  await startServer({ repoRoot: repoRootAbs, port, host, watch });
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
    // Lost a startup race — another daemon just bound the port. Join it.
    if (await joinExisting()) process.exit(0);
    process.stderr.write(`Port ${port} is already in use.\n`);
    process.exit(1);
  }
  throw e;
}
