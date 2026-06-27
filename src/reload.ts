import type { ReloadHub, ReloadScope, SseClient } from "./types.js";

/** Parent directory of a repo-relative posix path ("" for a top-level file). */
function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function scopeMatches(scope: ReloadScope, changedPaths: string[]): boolean {
  switch (scope.type) {
    case "all":
      return true;
    case "file":
      return changedPaths.includes(scope.path);
    case "dir":
      return changedPaths.some((p) => dirOf(p) === scope.path);
  }
}

export function createReloadHub(): ReloadHub {
  const clients = new Map<SseClient, ReloadScope>();
  let revision = 0;

  return {
    add(res, scope = { type: "all" }) {
      clients.set(res, scope);
      res.on("close", () => clients.delete(res));
    },
    notify(changedPaths) {
      // Bump the revision unconditionally so the polling fallback (/rev) still
      // detects changes, even though SSE delivery is scoped per client.
      revision++;
      const payload = `event: reload\ndata: ${Date.now()}\n\n`;
      for (const [res, scope] of clients) {
        if (scopeMatches(scope, changedPaths)) res.write(payload);
      }
    },
    getRevision() {
      return revision;
    },
    broadcastPing() {
      const payload = `event: ping\ndata: ${Date.now()}\n\n`;
      for (const res of clients.keys()) res.write(payload);
    },
    close() {
      for (const res of clients.keys()) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      clients.clear();
    },
  };
}
