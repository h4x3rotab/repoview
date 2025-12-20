import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import express from "express";
import chokidar from "chokidar";
import mime from "mime-types";

import { createMarkdownRenderer } from "./markdown.js";
import { loadGitIgnoreMatcher } from "./gitignore.js";
import { createRepoLinkScanner } from "./linkcheck.js";
import {
  renderBrokenLinksPage,
  renderErrorPage,
  renderFilePage,
  renderTreePage,
} from "./views.js";

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

function encodePathForUrl(posixPath) {
  return posixPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isWithinRoot(rootReal, candidateReal) {
  if (candidateReal === rootReal) return true;
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return candidateReal.startsWith(rootWithSep);
}

async function getGitInfo(repoRootReal) {
  const gitDir = path.join(repoRootReal, ".git");
  try {
    const stat = await fs.stat(gitDir);
    if (!stat.isDirectory()) return { branch: null, commit: null };
  } catch {
    return { branch: null, commit: null };
  }

  const execGit = async (args) => {
    return await new Promise((resolve) => {
      const child = spawn("git", args, { cwd: repoRootReal });
      let out = "";
      child.stdout.on("data", (chunk) => (out += String(chunk)));
      child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
      child.on("error", () => resolve(null));
    });
  };

  const [branch, commit] = await Promise.all([
    execGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    execGit(["rev-parse", "HEAD"]),
  ]);
  return { branch: branch && branch !== "HEAD" ? branch : branch, commit };
}

async function safeRealpath(rootReal, requestPath) {
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

async function statSafe(p, { followSymlinks = true } = {}) {
  const stat = followSymlinks ? await fs.stat(p) : await fs.lstat(p);
  return {
    isFile: stat.isFile(),
    isDir: stat.isDirectory(),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createReloadHub() {
  const clients = new Set();
  return {
    add(res) {
      clients.add(res);
      res.on("close", () => clients.delete(res));
    },
    broadcastReload() {
      const payload = `event: reload\ndata: ${Date.now()}\n\n`;
      for (const res of clients) res.write(payload);
    },
  };
}

export async function startServer({ repoRoot, host, port, watch }) {
  const repoRootReal = await fs.realpath(repoRoot);
  const repoName = path.basename(repoRootReal);
  const gitInfo = await getGitInfo(repoRootReal);
  const reloadHub = createReloadHub();
  const md = createMarkdownRenderer();
  let ignoreMatcher = await loadGitIgnoreMatcher(repoRootReal);
  const isIgnored = (relPosix, opts) => ignoreMatcher.ignores(relPosix, opts);
  const linkScanner = createRepoLinkScanner({ repoRootReal, markdownRenderer: md, isIgnored });

  const app = express();
  app.disable("x-powered-by");

  const publicDir = path.join(process.cwd(), "public");
  app.use("/static", express.static(publicDir, { fallthrough: true }));
  app.use(
    "/static/vendor/github-markdown-css",
    express.static(path.join(process.cwd(), "node_modules/github-markdown-css"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/highlight.js",
    express.static(path.join(process.cwd(), "node_modules/highlight.js"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/katex",
    express.static(path.join(process.cwd(), "node_modules/katex/dist"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/mermaid",
    express.static(path.join(process.cwd(), "node_modules/mermaid/dist"), {
      fallthrough: false,
    }),
  );

  app.use((req, res, next) => {
    if (!req.path.startsWith("/static/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/", (req, res) => res.redirect("/tree/"));

  void linkScanner.triggerScan();

  app.get("/broken-links.json", (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(linkScanner.getState());
  });

  app.get("/broken-links", (req, res) => {
    const showIgnored = req.query.ignored === "1";
    const query = new URLSearchParams();
    if (req.query.watch === "0") query.set("watch", "0");
    if (showIgnored) query.set("ignored", "1");
    const querySuffix = query.toString() ? `?${query.toString()}` : "";
    const toggleIgnoredSuffix = (() => {
      const q = new URLSearchParams(query);
      if (showIgnored) q.delete("ignored");
      else q.set("ignored", "1");
      return q.toString() ? `?${q.toString()}` : "";
    })();
    const toggleIgnoredHref = `/broken-links${toggleIgnoredSuffix}`;
    const state = linkScanner.getState();
    res.status(200).send(
      renderBrokenLinksPage({
        title: `${repoName} · Broken links`,
        repoName,
        gitInfo,
        relPathPosix: "",
        scanState: state,
        querySuffix,
        toggleIgnoredHref,
        showIgnored,
      }),
    );
  });

  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write("event: hello\ndata: ok\n\n");
    reloadHub.add(res);
  });

  app.get(["/tree/*", "/tree"], async (req, res) => {
    try {
      const showIgnored = req.query.ignored === "1";
      const query = new URLSearchParams();
      if (req.query.watch === "0") query.set("watch", "0");
      if (showIgnored) query.set("ignored", "1");
      const querySuffix = query.toString() ? `?${query.toString()}` : "";
      const toggleIgnoredSuffix = (() => {
        const q = new URLSearchParams(query);
        if (showIgnored) q.delete("ignored");
        else q.set("ignored", "1");
        return q.toString() ? `?${q.toString()}` : "";
      })();

      const p = req.params[0] ?? "";
      const { stripped, resolved } = await safeRealpath(repoRootReal, p);
      const toggleIgnoredHref = `/tree/${encodePathForUrl(
        toPosixPath(stripped),
      )}${toggleIgnoredSuffix}`;
      const st = await statSafe(resolved);
      if (st.isFile)
        return res.redirect(
          `/blob/${encodePathForUrl(toPosixPath(stripped))}${querySuffix}`,
        );

      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const readmeEntry = entries.find(
        (e) =>
          e.isFile() &&
          /^readme(?:\.(?:md|markdown|mdown|mkd|mkdn))?$/i.test(e.name),
      );
      const rows = await Promise.all(
        entries
          .filter((e) => {
            if (e.name === ".git") return false;
            if (showIgnored) return true;
            const relPosix = toPosixPath(path.posix.join(toPosixPath(stripped), e.name));
            return !ignoreMatcher.ignores(relPosix, { isDir: e.isDirectory() });
          })
          .map(async (e) => {
            const relPosix = toPosixPath(path.posix.join(toPosixPath(stripped), e.name));
            const full = path.join(resolved, e.name);
            const info = await statSafe(full, { followSymlinks: false });
            const isDir = e.isDirectory();
            const href = isDir
              ? `/tree/${encodePathForUrl(relPosix)}${querySuffix}`
              : `/blob/${encodePathForUrl(relPosix)}${querySuffix}`;
            return {
              name: e.name,
              isDir,
              href,
              size: isDir ? "" : formatBytes(info.size),
              mtime: formatDate(info.mtimeMs),
            };
          }),
      );

      rows.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      let readmeHtml = "";
      if (readmeEntry) {
        try {
          const readmeRel = toPosixPath(path.posix.join(toPosixPath(stripped), readmeEntry.name));
          if (!showIgnored && ignoreMatcher.ignores(readmeRel, { isDir: false }))
            throw new Error("ignored");
          const { resolved: readmePath } = await safeRealpath(repoRootReal, readmeRel);
          const readmeStat = await statSafe(readmePath);
          if (readmeStat.size <= 2 * 1024 * 1024) {
            const buf = await fs.readFile(readmePath);
            readmeHtml = md.render(buf.toString("utf8"), {
              baseDirPosix: toPosixPath(stripped),
            });
          }
        } catch {
          readmeHtml = "";
        }
      }

      res.status(200).send(
        renderTreePage({
          title: `${repoName}${stripped ? `/${stripped}` : ""}`,
          repoName,
          gitInfo,
          brokenLinks: linkScanner.getState(),
          relPathPosix: toPosixPath(stripped),
          querySuffix,
          toggleIgnoredHref,
          showIgnored,
          rows,
          readmeHtml,
        }),
      );
    } catch (e) {
      res
        .status(e.statusCode || 500)
        .send(renderErrorPage({ title: "Error", message: e.message }));
    }
  });

  app.get(["/blob/*", "/blob"], async (req, res) => {
    try {
      const showIgnored = req.query.ignored === "1";
      const query = new URLSearchParams();
      if (req.query.watch === "0") query.set("watch", "0");
      if (showIgnored) query.set("ignored", "1");
      const querySuffix = query.toString() ? `?${query.toString()}` : "";
      const toggleIgnoredSuffix = (() => {
        const q = new URLSearchParams(query);
        if (showIgnored) q.delete("ignored");
        else q.set("ignored", "1");
        return q.toString() ? `?${q.toString()}` : "";
      })();

      const p = req.params[0] ?? "";
      const { stripped, resolved } = await safeRealpath(repoRootReal, p);
      const toggleIgnoredHref = `/blob/${encodePathForUrl(
        toPosixPath(stripped),
      )}${toggleIgnoredSuffix}`;
      const st = await statSafe(resolved);
      if (st.isDir)
        return res.redirect(
          `/tree/${encodePathForUrl(toPosixPath(stripped))}${querySuffix}`,
        );

      const fileName = path.basename(resolved);
      const ext = path.extname(fileName).toLowerCase();
      const isMarkdown = [".md", ".markdown", ".mdown", ".mkd", ".mkdn"].includes(ext);
      const maxBytes = 2 * 1024 * 1024;

      if (st.size > maxBytes) {
        res.status(200).send(
          renderFilePage({
            title: `${repoName}/${stripped}`,
            repoName,
            gitInfo,
            brokenLinks: linkScanner.getState(),
            relPathPosix: toPosixPath(stripped),
            querySuffix,
            toggleIgnoredHref,
            showIgnored,
            fileName,
            isMarkdown: false,
            renderedHtml: `<div class="note">File is too large to render (${formatBytes(
              st.size,
            )}). Use <a href="/raw/${encodePathForUrl(
              toPosixPath(stripped),
            )}${querySuffix}">Raw</a>.</div>`,
          }),
        );
        return;
      }

      const raw = await fs.readFile(resolved);
      const text = raw.toString("utf8");

      let renderedHtml;
      if (isMarkdown) {
        const baseDir = toPosixPath(path.posix.dirname(toPosixPath(stripped)));
        renderedHtml = md.render(text, { baseDirPosix: baseDir === "." ? "" : baseDir });
      } else {
        renderedHtml = md.renderCodeBlock(text, {
          languageHint: ext ? ext.slice(1) : "",
        });
      }

      res.status(200).send(
        renderFilePage({
          title: `${repoName}/${stripped}`,
          repoName,
          gitInfo,
          brokenLinks: linkScanner.getState(),
          relPathPosix: toPosixPath(stripped),
          querySuffix,
          toggleIgnoredHref,
          showIgnored,
          fileName,
          isMarkdown,
          renderedHtml,
        }),
      );
    } catch (e) {
      res
        .status(e.statusCode || 500)
        .send(renderErrorPage({ title: "Error", message: e.message }));
    }
  });

  app.get(["/raw/*", "/raw"], async (req, res) => {
    try {
      const p = req.params[0] ?? "";
      const { resolved } = await safeRealpath(repoRootReal, p);
      const st = await statSafe(resolved);
      if (!st.isFile) {
        const err = new Error("Not a file");
        err.statusCode = 400;
        throw err;
      }

      const contentType = mime.contentType(path.extname(resolved)) || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.sendFile(resolved);
    } catch (e) {
      res
        .status(e.statusCode || 500)
        .send(renderErrorPage({ title: "Error", message: e.message }));
    }
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, host, resolve));

  if (watch) {
    const watcher = chokidar.watch(repoRootReal, {
      ignored: [
        /(^|[/\\])\.git([/\\]|$)/,
        /(^|[/\\])node_modules([/\\]|$)/,
      ],
      ignoreInitial: true,
    });
    let pending = null;
    watcher.on("all", () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        reloadHub.broadcastReload();
        void loadGitIgnoreMatcher(repoRootReal).then((m) => (ignoreMatcher = m));
        void linkScanner.triggerScan();
      }, 100);
    });
  }

  // eslint-disable-next-line no-console
  console.log(`repo-viewer: ${repoRootReal}`);
  // eslint-disable-next-line no-console
  console.log(`listening: http://${host}:${port}`);
}
