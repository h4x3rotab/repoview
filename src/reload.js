export function createReloadHub() {
  const clients = new Set();
  let revision = 0;
  return {
    add(res) {
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
