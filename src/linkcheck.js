import fs from "node:fs/promises";
import path from "node:path";

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

function isWithinRoot(rootReal, candidateReal) {
  if (candidateReal === rootReal) return true;
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return candidateReal.startsWith(rootWithSep);
}

async function safeResolveExisting(repoRootReal, relPosixPath) {
  const stripped = String(relPosixPath || "").replace(/^\/+/, "");
  const resolved = path.resolve(repoRootReal, stripped);
  if (!isWithinRoot(repoRootReal, resolved)) {
    return { ok: false, reason: "escape", resolved: null, type: null };
  }

  try {
    await fs.lstat(resolved);
  } catch {
    return { ok: false, reason: "missing", resolved: null, type: null };
  }

  let real;
  try {
    real = await fs.realpath(resolved);
  } catch {
    return { ok: false, reason: "missing", resolved: null, type: null };
  }
  if (!isWithinRoot(repoRootReal, real)) {
    return { ok: false, reason: "escape", resolved: null, type: null };
  }

  const stat = await fs.stat(real);
  return {
    ok: true,
    reason: null,
    resolved: real,
    type: stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other",
  };
}

function extractInternalUrlsFromHtml(html) {
  const urls = [];
  const re = /\b(?:href|src)=(["'])([^"']+)\1/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[2].trim();
    if (!raw || raw.startsWith("#")) continue;
    urls.push(raw);
  }
  return urls;
}

function decodePosixPathFromUrlPath(urlPathname, prefix) {
  const rest = urlPathname.slice(prefix.length);
  const stripped = rest.replace(/^\/+/, "");
  const segments = stripped.split("/").filter(Boolean);
  try {
    return segments.map((s) => decodeURIComponent(s)).join("/");
  } catch {
    return null;
  }
}

function isMarkdownFile(relPosix) {
  const lower = relPosix.toLowerCase();
  const base = path.posix.basename(lower);
  if (base === "readme" || base.startsWith("readme.")) return true;
  const ext = path.posix.extname(lower).replace(/^\./, "");
  return new Set(["md", "markdown", "mdown", "mkd", "mkdn"]).has(ext);
}

async function listMarkdownFiles(repoRootReal, { maxFiles, isIgnored } = {}) {
  const results = [];
  const stack = [{ abs: repoRootReal, relPosix: "" }];
  const ignoredNames = new Set([".git", "node_modules"]);

  while (stack.length) {
    const { abs, relPosix } = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (ignoredNames.has(e.name)) continue;
      const childAbs = path.join(abs, e.name);
      const childRel = relPosix ? `${relPosix}/${e.name}` : e.name;
      const childRelPosix = toPosixPath(childRel);

      if (typeof isIgnored === "function" && isIgnored(childRelPosix, { isDir: e.isDirectory() }))
        continue;

      if (e.isDirectory()) {
        stack.push({ abs: childAbs, relPosix: childRelPosix });
      } else if (e.isFile()) {
        if (isMarkdownFile(childRelPosix)) results.push(childRelPosix);
        if (maxFiles && results.length >= maxFiles) return results;
      }
    }
  }
  results.sort();
  return results;
}

export function createRepoLinkScanner({ repoRootReal, markdownRenderer, isIgnored }) {
  let current = {
    status: "idle",
    lastResult: null,
    lastError: null,
    lastStartedAt: null,
    lastFinishedAt: null,
  };

  let scanRunning = false;
  let scanQueued = false;

  async function scanOnce({
    maxMarkdownFiles = 5000,
    maxBytesPerFile = 2 * 1024 * 1024,
    concurrency = 16,
  } = {}) {
    const startedAt = Date.now();
    current = { ...current, status: "running", lastError: null, lastStartedAt: startedAt };

    const markdownFiles = await listMarkdownFiles(repoRootReal, {
      maxFiles: maxMarkdownFiles,
      isIgnored,
    });
    const broken = [];
    let filesScanned = 0;
    let urlsChecked = 0;

    const queue = markdownFiles.slice();
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const relPosix = queue.pop();
        if (!relPosix) return;

        const abs = path.join(repoRootReal, relPosix);
        let stat;
        try {
          stat = await fs.stat(abs);
        } catch {
          continue;
        }
        if (stat.size > maxBytesPerFile) continue;

        let text;
        try {
          text = await fs.readFile(abs, "utf8");
        } catch {
          continue;
        }

        filesScanned++;
        const baseDirPosix = path.posix.dirname(relPosix);
        const env = { baseDirPosix: baseDirPosix === "." ? "" : baseDirPosix };
        let html = "";
        try {
          html = markdownRenderer.render(text, env);
        } catch {
          continue;
        }

        const urls = extractInternalUrlsFromHtml(html);
        for (const raw of urls) {
          if (raw.startsWith("http://") || raw.startsWith("https://")) continue;
          if (raw.startsWith("//")) continue;
          if (raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
          if (raw.startsWith("data:")) continue;
          urlsChecked++;

          let urlPath;
          try {
            urlPath = new URL(raw, "http://local").pathname;
          } catch {
            broken.push({
              source: relPosix,
              url: raw,
              kind: "url",
              reason: "invalid_url",
            });
            continue;
          }

          if (urlPath === "/events" || urlPath.startsWith("/static/")) continue;
          if (urlPath === "/broken-links" || urlPath === "/broken-links.json") continue;

          let expected = null;
          let expectType = null;
          if (urlPath.startsWith("/blob/")) {
            expected = decodePosixPathFromUrlPath(urlPath, "/blob/");
            expectType = "blob";
          } else if (urlPath.startsWith("/tree/")) {
            expected = decodePosixPathFromUrlPath(urlPath, "/tree/");
            expectType = "tree";
          } else if (urlPath.startsWith("/raw/")) {
            expected = decodePosixPathFromUrlPath(urlPath, "/raw/");
            expectType = "raw";
          } else {
            broken.push({
              source: relPosix,
              url: raw,
              kind: "url",
              reason: "unknown_route",
            });
            continue;
          }

          if (expected == null) {
            broken.push({
              source: relPosix,
              url: raw,
              kind: expectType,
              reason: "bad_encoding",
            });
            continue;
          }

          if (typeof isIgnored === "function") {
            if (expectType === "tree" && isIgnored(expected, { isDir: true })) continue;
            if (expectType !== "tree" && isIgnored(expected, { isDir: false })) continue;
          }

          const resolved = await safeResolveExisting(repoRootReal, expected);
          if (!resolved.ok) {
            broken.push({
              source: relPosix,
              url: raw,
              kind: expectType,
              reason: resolved.reason,
              target: expected,
            });
            continue;
          }

          if (expectType === "raw" && resolved.type !== "file") {
            broken.push({
              source: relPosix,
              url: raw,
              kind: expectType,
              reason: "not_a_file",
              target: expected,
            });
          } else if (expectType === "tree" && resolved.type !== "dir") {
            broken.push({
              source: relPosix,
              url: raw,
              kind: expectType,
              reason: "not_a_directory",
              target: expected,
            });
          }
        }
      }
    });

    await Promise.all(workers);

    const finishedAt = Date.now();
    const result = {
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      filesScanned,
      urlsChecked,
      broken: broken.sort((a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url)),
    };

    current = {
      status: "idle",
      lastResult: result,
      lastError: null,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
    };
    return result;
  }

  async function triggerScan(options) {
    if (scanRunning) {
      scanQueued = true;
      return current;
    }
    scanRunning = true;
    try {
      await scanOnce(options);
    } catch (e) {
      current = { ...current, status: "idle", lastError: String(e?.message || e) };
    } finally {
      scanRunning = false;
      if (scanQueued) {
        scanQueued = false;
        void triggerScan(options);
      }
    }
    return current;
  }

  function getState() {
    return current;
  }

  return { scanOnce, triggerScan, getState };
}
