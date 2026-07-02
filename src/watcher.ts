import fs from "node:fs";
import path from "node:path";
import { toPosixPath } from "./paths.js";

export interface RepoWatcherOptions {
  repoRootReal: string;
  isIgnored: (relPosix: string, opts?: { isDir?: boolean }) => boolean;
  onChange: (relPosixPaths: string[]) => void;
  onError?: (error: Error) => void;
}

function isWithinRepo(repoRootReal: string, candidate: string): boolean {
  if (candidate === repoRootReal) return true;
  const rootWithSep = repoRootReal.endsWith(path.sep) ? repoRootReal : repoRootReal + path.sep;
  return candidate.startsWith(rootWithSep);
}

/**
 * Watch a repo using Node's native recursive fs.watch.
 *
 * On macOS this uses a single FSEvents stream; on Windows a single
 * ReadDirectoryChangesW handle; on Linux (Node 19.1+) inotify recursive.
 *
 * Falls back to no watcher if recursive watching is unsupported, calling
 * onError so the caller can warn the user.
 */
export function createRepoWatcher(options: RepoWatcherOptions): { close: () => void } | null {
  const { repoRootReal, isIgnored, onChange, onError } = options;

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(repoRootReal, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const absolute = path.resolve(repoRootReal, filename);
      if (!isWithinRepo(repoRootReal, absolute)) return;
      const relPosix = toPosixPath(path.relative(repoRootReal, absolute));
      if (
        relPosix === "" ||
        relPosix.startsWith(".git/") ||
        relPosix.startsWith("node_modules/") ||
        relPosix.startsWith(".repoview/")
      )
        return;
      if (isIgnored(relPosix, { isDir: false })) return;
      onChange([relPosix]);
    });
  } catch (error) {
    onError?.(error as Error);
    return null;
  }

  return {
    close() {
      watcher?.close();
    },
  };
}
