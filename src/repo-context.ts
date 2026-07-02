import fs from "node:fs/promises";
import path from "node:path";

import { loadGitIgnoreMatcher } from "./gitignore.js";
import { createRepoLinkScanner } from "./linkcheck.js";
import { getGitInfo } from "./git.js";
import { createReloadHub } from "./reload.js";
import { createRepoWatcher } from "./watcher.js";
import type { LinkScanner, MarkdownRenderer, RepoContext } from "./types.js";

export interface CreateRepoContextOptions {
  id?: string;
  repoRoot: string;
  md: MarkdownRenderer;
  watch?: boolean;
}

/**
 * Build the per-repo runtime state. Each context owns its own git info,
 * gitignore matcher, link scanner, review dir, reload hub and (optionally) a
 * filesystem watcher. The markdown renderer is shared across repos and passed in.
 */
export async function createRepoContext({
  id,
  repoRoot,
  md,
  watch = true,
}: CreateRepoContextOptions): Promise<RepoContext> {
  const repoRootReal = await fs.realpath(repoRoot);
  const repoName = path.basename(repoRootReal);
  const gitInfo = await getGitInfo(repoRootReal);
  const reloadHub = createReloadHub();
  const reviewDir = path.join(repoRootReal, ".repoview", "reviews");

  const ctx: RepoContext = {
    id: id ?? repoName,
    repoRootReal,
    repoName,
    gitInfo,
    reloadHub,
    reviewDir,
    md,
    ignoreMatcher: await loadGitIgnoreMatcher(repoRootReal),
    isIgnored: () => false,
    linkScanner: undefined as unknown as LinkScanner,
    watcher: null,
    close: async () => {},
  };

  ctx.isIgnored = (relPosix, opts) => ctx.ignoreMatcher.ignores(relPosix, opts);
  ctx.linkScanner = createRepoLinkScanner({
    repoRootReal,
    markdownRenderer: md,
    isIgnored: ctx.isIgnored,
  });

  void ctx.linkScanner.triggerScan();

  if (watch) {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const changed = new Set<string>();
    const watcher = createRepoWatcher({
      repoRootReal,
      isIgnored: ctx.isIgnored,
      onChange: (paths) => {
        for (const p of paths) changed.add(p);
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          const batch = [...changed];
          changed.clear();
          reloadHub.notify(batch);
          void loadGitIgnoreMatcher(repoRootReal).then((m) => (ctx.ignoreMatcher = m));
          void ctx.linkScanner.triggerScan();
        }, 100);
      },
      onError: (error) => {
        // Warn but keep serving. Live reload simply won't work.
        // eslint-disable-next-line no-console
        console.warn(
          `repoview: live reload unavailable for ${repoRootReal}: ${error.message}`,
        );
      },
    });
    if (watcher) ctx.watcher = watcher as unknown as RepoContext["watcher"];
  }

  ctx.close = async () => {
    reloadHub.close();
    if (ctx.watcher) ctx.watcher.close();
  };

  return ctx;
}
