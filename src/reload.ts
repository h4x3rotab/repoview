import type { ReloadHub, SseClient } from "./types.js";

export function createReloadHub(): ReloadHub {
  const clients = new Set<SseClient>();
  let revision = 0;
  return {
    add(res: SseClient) {
      clients.add(res);
      res.on("close", () => clients.delete(res));
    },
    broadcastReload() {
      revision++;
      const payload = `event: reload\ndata: ${Date.now()}\n\n`;
      for (const res of clients) res.write(payload);
    },
    getRevision() {
      return revision;
    },
    broadcastPing() {
      const payload = `event: ping\ndata: ${Date.now()}\n\n`;
      for (const res of clients) res.write(payload);
    },
    close() {
      for (const res of clients) {
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
