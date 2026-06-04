import path from "node:path";
import express from "express";
import type { Request, Response } from "express";

import { renderGistPage, renderGistListPage, renderErrorPage } from "./views.js";
import type { GistStore, MarkdownRenderer } from "./types.js";
import type { HttpError } from "./paths.js";

const ID_RE = /^[A-Za-z0-9_-]+$/;
const MD_EXT = new Set([".md", ".markdown", ".mdown", ".mkd", ".mkdn"]);

export interface GistRouterDeps {
  store: GistStore;
  md: MarkdownRenderer;
  /** REPOVIEW_BASE_URL — authoritative public origin for returned links. */
  baseUrlEnv?: string;
}

/** Resolve the absolute base URL for returned gist links. */
function resolveBaseUrl(req: Request, baseUrlEnv?: string): string {
  if (baseUrlEnv) return baseUrlEnv.replace(/\/+$/, "");
  const host = req.get("host");
  if (host) return `${req.protocol}://${host}`;
  return "";
}

/**
 * Routes for ephemeral gists: `POST /api/gists` (publish, open so remote agents
 * can use it), `GET /gist/:id` (preview), `GET /gist/:id/raw`, and `GET /gists`
 * (the list page).
 */
export function createGistRouter({ store, md, baseUrlEnv }: GistRouterDeps) {
  const router = express.Router();

  router.post("/api/gists", express.json({ limit: "2mb" }), (req: Request, res: Response) => {
    try {
      const { content, filename, title, ttlSeconds } = req.body ?? {};
      const ttlMs =
        typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds) && ttlSeconds > 0
          ? ttlSeconds * 1000
          : undefined;
      const gist = store.create({ content, filename, title, ttlMs });
      const base = resolveBaseUrl(req, baseUrlEnv);
      res.status(201).json({
        id: gist.id,
        filename: gist.filename,
        title: gist.title,
        url: `${base}/gist/${gist.id}`,
        rawUrl: `${base}/gist/${gist.id}/raw`,
        createdAt: new Date(gist.createdAt).toISOString(),
        expiresAt: new Date(gist.expiresAt).toISOString(),
      });
    } catch (e) {
      const err = e as HttpError;
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.get("/gists", (req: Request, res: Response) => {
    res.send(renderGistListPage({ gists: store.list() }));
  });

  router.get("/gist/:id/raw", (req: Request, res: Response) => {
    if (!ID_RE.test(req.params.id)) {
      return res.status(400).type("text/plain").send("Invalid gist id");
    }
    const gist = store.get(req.params.id);
    if (!gist) {
      return res.status(404).type("text/plain").send("Gist not found or expired");
    }
    res.type("text/plain; charset=utf-8").send(gist.content);
  });

  router.get("/gist/:id", (req: Request, res: Response) => {
    if (!ID_RE.test(req.params.id)) {
      return res.status(400).send(
        renderErrorPage({
          title: "Error",
          message: "Invalid gist id",
          repoBase: "",
          repos: [],
          currentRepoId: "",
        }),
      );
    }
    const gist = store.get(req.params.id);
    if (!gist) {
      return res.status(404).send(
        renderGistListPage({
          gists: store.list(),
          notice: "That gist has expired or does not exist.",
        }),
      );
    }
    const ext = path.posix.extname(gist.filename).toLowerCase();
    const isMarkdown = MD_EXT.has(ext);
    const html = isMarkdown
      ? md.render(gist.content, { baseDirPosix: "", repoBase: "" })
      : md.renderCodeBlock(gist.content, { languageHint: ext ? ext.slice(1) : "" });
    res.send(renderGistPage({ gist, html, isMarkdown }));
  });

  return router;
}
