#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { startServer } from "./server.js";
import { handleReviewCommand } from "./review-cli.js";
import type { RepoSummary } from "./types.js";

function printHelp() {
  // Keep this in sync with README.md
  process.stdout.write(`repoview

Serve local Git repositories as a GitHub-like website. Multiple invocations on
the same port join one shared session (like tmux) — the first run starts the
daemon, later runs register their repo and exit.

Usage:
  npx repoview [--repo /path/to/repo] [--host 0.0.0.0] [--port 7376] [--no-watch]
  repoview [--repo /path/to/repo] [--host 0.0.0.0] [--port 7376] [--no-watch]

Options:
  --repo <path>     Repository root (default: REPO_ROOT or current dir)
  --host <host>     Bind address (default: 0.0.0.0)
  --port <port>     Bind/session port (default: 7376)
  --watch           Enable live reload (default)
  --no-watch        Disable live reload
  -h, --help        Show this help

Session subcommands (target the daemon on --port):
  repoview ls                     List repos in the session
  repoview rm <id|path>           Unregister a repo from the session
  repoview stop                   Shut the session daemon down

Review subcommands:
  repoview review new --title "Title"               Create a new review thread
  repoview review post <id> --role agent --body "…" Post a message to a thread
  repoview review post <id> --role agent --file f   Post from file
  repoview review read <id>                          Read thread messages + comments
  repoview review list                               List all threads

Environment:
  REPO_ROOT, HOST, PORT
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
