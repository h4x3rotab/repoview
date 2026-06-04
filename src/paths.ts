import fs from "node:fs/promises";
import path from "node:path";

/** An Error carrying an HTTP status code for the route error handler. */
export interface HttpError extends Error {
  statusCode?: number;
}

export interface SafeStat {
  isFile: boolean;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function encodePathForUrl(posixPath: string): string {
  return posixPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function isWithinRoot(rootReal: string, candidateReal: string): boolean {
  if (candidateReal === rootReal) return true;
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return candidateReal.startsWith(rootWithSep);
}

export async function safeRealpath(
  rootReal: string,
  requestPath: string,
): Promise<{ stripped: string; resolved: string }> {
  const stripped = String(requestPath || "").replace(/^\/+/, "");
  const resolved = path.resolve(rootReal, stripped);
  if (!isWithinRoot(rootReal, resolved)) {
    const err: HttpError = new Error("Path escapes repo root");
    err.statusCode = 400;
    throw err;
  }

  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch (e) {
    (e as HttpError).statusCode = 404;
    throw e;
  }
  if (!isWithinRoot(rootReal, real)) {
    const err: HttpError = new Error("Path resolves outside repo root");
    err.statusCode = 400;
    throw err;
  }
  return { stripped, resolved: real };
}

export async function statSafe(
  p: string,
  { followSymlinks = true }: { followSymlinks?: boolean } = {},
): Promise<SafeStat | null> {
  try {
    const stat = followSymlinks ? await fs.stat(p) : await fs.lstat(p);
    return {
      isFile: stat.isFile(),
      isDir: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return null;
    }
    throw e;
  }
}
