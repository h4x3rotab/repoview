import crypto from "node:crypto";
import path from "node:path";

import type { Gist, GistStore } from "./types.js";
import type { HttpError } from "./paths.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export interface GistStoreOptions {
  defaultTtlMs?: number;
  maxTtlMs?: number;
  minTtlMs?: number;
  maxContentBytes?: number;
  maxGists?: number;
  sweepIntervalMs?: number;
}

function httpError(message: string, statusCode: number): HttpError {
  const err: HttpError = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sanitizeFilename(name: string | undefined): string {
  const base = path.posix.basename(String(name || "").trim());
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100);
  return cleaned || "gist.md";
}

/**
 * In-memory store of ephemeral published files ("gists"). Nothing is persisted —
 * gists do not survive a restart — and each one expires after its TTL (default
 * 24h). A background sweeper drops expired entries; access also expires lazily.
 */
export function createGistStore(opts: GistStoreOptions = {}): GistStore {
  const defaultTtlMs = opts.defaultTtlMs ?? DAY;
  const maxTtlMs = opts.maxTtlMs ?? 7 * DAY;
  const minTtlMs = opts.minTtlMs ?? MINUTE;
  const maxContentBytes = opts.maxContentBytes ?? 1024 * 1024;
  const maxGists = opts.maxGists ?? 500;
  const sweepIntervalMs = opts.sweepIntervalMs ?? 5 * MINUTE;

  const gists = new Map<string, Gist>();

  function genId(): string {
    return crypto.randomBytes(9).toString("base64url"); // 12 url-safe chars
  }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, g] of gists) if (g.expiresAt <= now) gists.delete(id);
  }, sweepIntervalMs);
  timer.unref?.();

  return {
    create({ content, filename, title, ttlMs }) {
      if (typeof content !== "string" || content.length === 0) {
        throw httpError("content is required", 400);
      }
      if (Buffer.byteLength(content, "utf8") > maxContentBytes) {
        throw httpError("content too large", 413);
      }
      const ttl = Math.min(maxTtlMs, Math.max(minTtlMs, ttlMs ?? defaultTtlMs));
      const now = Date.now();

      // Cap memory use: evict the oldest gist when at capacity.
      if (gists.size >= maxGists) {
        let oldestId: string | null = null;
        let oldest = Infinity;
        for (const [id, g] of gists) {
          if (g.createdAt < oldest) {
            oldest = g.createdAt;
            oldestId = id;
          }
        }
        if (oldestId) gists.delete(oldestId);
      }

      let id = genId();
      while (gists.has(id)) id = genId();

      const gist: Gist = {
        id,
        title: title && title.trim() ? title.trim() : null,
        filename: sanitizeFilename(filename),
        content,
        createdAt: now,
        expiresAt: now + ttl,
      };
      gists.set(id, gist);
      return gist;
    },

    get(id) {
      const g = gists.get(id);
      if (!g) return undefined;
      if (g.expiresAt <= Date.now()) {
        gists.delete(id);
        return undefined;
      }
      return g;
    },

    list() {
      const now = Date.now();
      const out: Gist[] = [];
      for (const [id, g] of gists) {
        if (g.expiresAt <= now) {
          gists.delete(id);
          continue;
        }
        out.push(g);
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },

    delete(id) {
      return gists.delete(id);
    },

    close() {
      clearInterval(timer);
      gists.clear();
    },
  };
}
