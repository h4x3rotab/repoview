import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

export async function loadGitIgnoreMatcher(repoRootReal) {
  const ig = ignore();

  // Baseline ignores (never show these via toggle either).
  ig.add([".git/"]);

  try {
    const content = await fs.readFile(path.join(repoRootReal, ".gitignore"), "utf8");
    ig.add(content);
  } catch {
    // No .gitignore or unreadable; ignore.
  }

  return {
    ignores(relPathPosix, { isDir = false } = {}) {
      const p = toPosixPath(String(relPathPosix || "").replace(/^\/+/, ""));
      if (!p) return false;
      if (ig.ignores(p)) return true;
      if (isDir) {
        const withSlash = p.endsWith("/") ? p : `${p}/`;
        if (ig.ignores(withSlash)) return true;
      }
      return false;
    },
  };
}
