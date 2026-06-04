import express from "express";
import type { Request, Response, NextFunction } from "express";

import type { Session } from "./session.js";
import { isLoopbackAddress } from "./net.js";

/** Restrict a mutating control endpoint to loopback clients. */
function requireLoopback(req: Request, res: Response, next: NextFunction) {
  if (isLoopbackAddress(req.socket.remoteAddress)) return next();
  res.status(403).json({ error: "Control endpoints are restricted to localhost" });
}

export interface CreateApiRouterOptions {
  version: string;
  onShutdown: () => void;
}

/**
 * The session control API. `GET /api/session` doubles as the join-handshake
 * signature; mutating routes (register/unregister/shutdown) are loopback-only.
 */
export function createApiRouter(session: Session, { version, onShutdown }: CreateApiRouterOptions) {
  const router = express.Router();

  router.get("/session", (req, res) => {
    res.json({ app: "repoview", version, repos: session.listRepos() });
  });

  router.get("/repos", (req, res) => {
    res.json({ repos: session.listRepos() });
  });

  router.post("/repos", requireLoopback, express.json(), async (req, res) => {
    try {
      const repoRoot = req.body?.path;
      if (!repoRoot || typeof repoRoot !== "string") {
        return res.status(400).json({ error: "path is required" });
      }
      const watch = req.body?.watch !== false;
      const ctx = await session.addRepo({ repoRoot, watch });
      res.status(201).json({
        id: ctx.id,
        name: ctx.repoName,
        path: ctx.repoRootReal,
        url: `/r/${ctx.id}/tree/`,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.delete("/repos/:id", requireLoopback, async (req, res) => {
    try {
      const removed = await session.removeRepo(req.params.id);
      if (!removed) return res.status(404).json({ error: "Repo not found" });
      res.json({ ok: true, id: removed.id });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post("/shutdown", requireLoopback, (req, res) => {
    res.json({ ok: true });
    // Defer so the response flushes before the process tears down.
    setTimeout(onShutdown, 50);
  });

  return router;
}
