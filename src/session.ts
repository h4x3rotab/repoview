import fs from "node:fs/promises";
import path from "node:path";

import { createMarkdownRenderer } from "./markdown.js";
import { createRepoContext } from "./repo-context.js";
import type { MarkdownRenderer, RepoContext, RepoSummary } from "./types.js";

export type { RepoSummary };

export interface Session {
  readonly md: MarkdownRenderer;
  addRepo(opts: { repoRoot: string; watch?: boolean }): Promise<RepoContext>;
  removeRepo(idOrPath: string): Promise<RepoContext | null>;
  getRepo(id: string): RepoContext | undefined;
  getDefaultId(): string | undefined;
  listRepos(): RepoSummary[];
  close(): Promise<void>;
}

/** Turn a directory basename into a URL-safe repo id slug. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug || "repo";
}

/**
 * A session owns a set of repos served behind one port. The first repo is the
 * "default" used for legacy (non-`/r/<id>`) URLs. Repos can be added/removed at
 * runtime (e.g. when another `repoview` invocation joins this daemon).
 */
export function createSession(): Session {
  const repos = new Map<string, RepoContext>();
  const order: string[] = [];
  const md = createMarkdownRenderer();

  function summarize(ctx: RepoContext): RepoSummary {
    return { id: ctx.id, name: ctx.repoName, path: ctx.repoRootReal, branch: ctx.gitInfo.branch };
  }

  return {
    md,

    async addRepo({ repoRoot, watch = true }) {
      const repoRootReal = await fs.realpath(repoRoot);

      // Idempotent: the same realpath is only ever registered once.
      for (const existing of repos.values()) {
        if (existing.repoRootReal === repoRootReal) return existing;
      }

      const base = slugify(path.basename(repoRootReal));
      let id = base;
      let n = 2;
      while (repos.has(id)) id = `${base}-${n++}`;

      const ctx = await createRepoContext({ id, repoRoot: repoRootReal, md, watch });
      repos.set(id, ctx);
      order.push(id);
      return ctx;
    },

    async removeRepo(idOrPath) {
      let id = idOrPath;
      if (!repos.has(id)) {
        // Allow removal by path as well as by id.
        let real: string | null = null;
        try {
          real = await fs.realpath(idOrPath);
        } catch {
          real = null;
        }
        const match = [...repos.values()].find(
          (c) => c.repoRootReal === real || c.repoRootReal === idOrPath,
        );
        if (!match) return null;
        id = match.id;
      }
      const ctx = repos.get(id);
      if (!ctx) return null;
      await ctx.close();
      repos.delete(id);
      const idx = order.indexOf(id);
      if (idx !== -1) order.splice(idx, 1);
      return ctx;
    },

    getRepo(id) {
      return repos.get(id);
    },

    getDefaultId() {
      return order[0];
    },

    listRepos() {
      return order.map((id) => summarize(repos.get(id)!));
    },

    async close() {
      await Promise.all([...repos.values()].map((c) => c.close()));
      repos.clear();
      order.length = 0;
    },
  };
}
