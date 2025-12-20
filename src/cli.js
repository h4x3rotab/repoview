#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";

function parseArgs(argv) {
  const args = { watch: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
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

const { repo, port, host, watch } = parseArgs(process.argv.slice(2));
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
