import fs from "node:fs/promises";
import path from "node:path";

export function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

export function encodePathForUrl(posixPath) {
  return posixPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function isWithinRoot(rootReal, candidateReal) {
  if (candidateReal === rootReal) return true;
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return candidateReal.startsWith(rootWithSep);
}

export async function safeRealpath(rootReal, requestPath) {
  const stripped = String(requestPath || "").replace(/^\/+/, "");
  const resolved = path.resolve(rootReal, stripped);
  if (!isWithinRoot(rootReal, resolved)) {
    const err = new Error("Path escapes repo root");
    err.statusCode = 400;
    throw err;
  }

  let real;
  try {
    real = await fs.realpath(resolved);
  } catch (e) {
    e.statusCode = 404;
    throw e;
  }
  if (!isWithinRoot(rootReal, real)) {
    const err = new Error("Path resolves outside repo root");
    err.statusCode = 400;
    throw err;
  }
  return { stripped, resolved: real };
}

export async function statSafe(p, { followSymlinks = true } = {}) {
  try {
    const stat = followSymlinks ? await fs.stat(p) : await fs.lstat(p);
    return {
      isFile: stat.isFile(),
      isDir: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (e) {
    if (e.code === "EACCES" || e.code === "EPERM") {
      return null;
    }
    throw e;
  }
}
