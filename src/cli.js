#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";

function printHelp() {
  // Keep this in sync with README.md
  process.stdout.write(`repo-viewer

Serve a local Git repository as a GitHub-like website.

Usage:
  npm start -- --repo /path/to/repo [--host 127.0.0.1] [--port 3000] [--no-watch]
  node src/cli.js --repo /path/to/repo [--host 127.0.0.1] [--port 3000] [--no-watch]

Options:
  --repo <path>     Repository root (default: REPO_ROOT or project dir)
  --host <host>     Bind address (default: 127.0.0.1)
  --port <port>     Bind port (default: 3000)
  --watch           Enable live reload (default)
  --no-watch        Disable live reload
  -h, --help        Show this help

Environment:
  REPO_ROOT, HOST, PORT
`);
}

function parseArgs(argv) {
  const args = { watch: true };
  const rest = [];
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parsed = parseArgs(process.argv.slice(2));
const { repo, port, host, watch, help } = parsed;

if (help) {
  printHelp();
  process.exit(0);
}

if (port != null && !Number.isFinite(port)) {
  process.stderr.write("Invalid --port value\n");
  process.exit(2);
}

const repoRoot =
  repo ??
  process.env.REPO_ROOT ??
  path.resolve(__dirname, "..");

await startServer({
  repoRoot,
  port: port || Number(process.env.PORT) || 3000,
  host: host || process.env.HOST || "127.0.0.1",
  watch,
});
