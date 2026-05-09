import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import chokidar from "chokidar";
import mime from "mime-types";

import { createMarkdownRenderer } from "./markdown.js";
import { loadGitIgnoreMatcher } from "./gitignore.js";
import { createRepoLinkScanner } from "./linkcheck.js";
import diff2html from "diff2html";
import {
  escapeHtml,
  renderBrokenLinksPage,
  renderDiffPage,
  renderErrorPage,
  renderFilePage,
  renderReviewListPage,
  renderReviewThreadPage,
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

function parseCsv(text, delimiter = ",") {
  const rows = [];
  let current = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        current.push(cell);
        cell = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        if (ch === "\r") i++;
        current.push(cell);
        rows.push(current);
        current = [];
        cell = "";
      } else if (ch === "\r") {
        current.push(cell);
        rows.push(current);
        current = [];
        cell = "";
      } else {
        cell += ch;
      }
    }
  }
  if (cell || current.length) {
    current.push(cell);
    rows.push(current);
  }
  return rows;
}

function renderCsvTable(rows, escFn) {
  if (!rows.length) return "<p>Empty file</p>";
  const header = rows[0];
  const body = rows.slice(1);
  const ths = header.map((h) => `<th>${escFn(h)}</th>`).join("");
  const trs = body
    .map((row) => `<tr>${row.map((c) => `<td>${escFn(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<div class="csv-table-wrap"><table class="csv-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

function execGit(repoRootReal, args, maxBytes = 1024 * 1024) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoRootReal });
    let out = "";
    let size = 0;
    let killed = false;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        if (!killed) { killed = true; child.kill(); }
        return;
      }
      out += String(chunk);
    });
    child.on("close", (code) => {
      if (killed) return resolve({ output: out, tooLarge: true, code });
      resolve({ output: code === 0 ? out.trim() : null, tooLarge: false, code });
    });
    child.on("error", () => resolve({ output: null, tooLarge: false, code: -1 }));
  });
}

function validateGitRef(ref) {
  if (!ref || typeof ref !== "string") return false;
  return /^[a-zA-Z0-9_.\/\-~^]+$/.test(ref);
}

async function getGitBranches(repoRootReal) {
  const { output } = await execGit(repoRootReal, ["branch", "--format=%(refname:short)"]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

async function getGitTags(repoRootReal) {
  const { output } = await execGit(repoRootReal, ["tag", "-l"]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

async function getGitDiffRaw(repoRootReal, base) {
  const maxBytes = 512 * 1024;
  const { output, tooLarge } = await execGit(repoRootReal, ["diff", base], maxBytes);
  return { raw: output || "", tooLarge };
}

async function getGitInfo(repoRootReal) {
  const gitDir = path.join(repoRootReal, ".git");
  try {
    await fs.stat(gitDir);
  } catch {
    return { branch: null, commit: null };
  }

  const [branchResult, commitResult] = await Promise.all([
    execGit(repoRootReal, ["rev-parse", "--abbrev-ref", "HEAD"]),
    execGit(repoRootReal, ["rev-parse", "HEAD"]),
  ]);
  const branch = branchResult.output;
  const commit = commitResult.output;
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
  let revision = 0;
  return {
    add(res) {
      clients.add(res);
      res.on("close", () => clients.delete(res));
    },
    broadcastReload() {
      revision++;
      const payload = `event: reload\ndata: ${Date.now()}\n\n`;
      for (const res of clients) res.write(payload);
    },
    getRevision() {
      return revision;
    },
    broadcastPing() {
      const payload = `event: ping\ndata: ${Date.now()}\n\n`;
      for (const res of clients) res.write(payload);
    },
  };
}

export async function startServer({ repoRoot, host, port, watch }) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, "..");
  const require = createRequire(import.meta.url);

  const resolvePackageDir = (name) => {
    const pkgJson = require.resolve(`${name}/package.json`);
    return path.dirname(pkgJson);
  };

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

  const publicDir = path.join(packageRoot, "public");
  app.use("/static", express.static(publicDir, { fallthrough: true }));
  app.use(
    "/static/vendor/github-markdown-css",
    express.static(resolvePackageDir("github-markdown-css"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/highlight.js",
    express.static(resolvePackageDir("highlight.js"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/katex",
    express.static(path.join(resolvePackageDir("katex"), "dist"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/mermaid",
    express.static(path.join(resolvePackageDir("mermaid"), "dist"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/diff2html",
    express.static(path.join(resolvePackageDir("diff2html"), "bundles", "css"), {
      fallthrough: false,
    }),
  );

  app.use((req, res, next) => {
    if (!req.path.startsWith("/static/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/", (req, res) => res.redirect("/tree/"));

  void linkScanner.triggerScan();

  app.get("/rev", (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send({ revision: reloadHub.getRevision() });
  });

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

    const interval = setInterval(() => {
      try {
        res.write(":\n\n");
        reloadHub.broadcastPing();
      } catch {
        // ignore
      }
    }, 15000);
    res.on("close", () => clearInterval(interval));
  });

  app.get("/diff", async (req, res) => {
    try {
      const base = req.query.base || "HEAD";
      if (!validateGitRef(base)) {
        const err = new Error("Invalid base ref");
        err.statusCode = 400;
        throw err;
      }

      if (!gitInfo.commit) {
        const err = new Error("Not a git repository");
        err.statusCode = 400;
        throw err;
      }

      const query = new URLSearchParams();
      if (req.query.watch === "0") query.set("watch", "0");
      if (req.query.ignored === "1") query.set("ignored", "1");
      if (base !== "HEAD") query.set("base", base);
      if (req.query.show_all === "1") query.set("show_all", "1");
      const querySuffix = query.toString() ? `?${query.toString()}` : "";

      const [branches, tags, diffResult] = await Promise.all([
        getGitBranches(repoRootReal),
        getGitTags(repoRootReal),
        getGitDiffRaw(repoRootReal, base),
      ]);

      const MAX_DIFF_FILES = 30;
      let diffHtml = "";
      let fileCount = 0;
      const showAll = req.query.show_all === "1";
      if (!diffResult.tooLarge && diffResult.raw) {
        const parsed = diff2html.parse(diffResult.raw);
        fileCount = parsed.length;
        const toRender = (!showAll && parsed.length > MAX_DIFF_FILES)
          ? parsed.slice(0, MAX_DIFF_FILES)
          : parsed;
        diffHtml = diff2html.html(toRender, {
          outputFormat: "line-by-line",
          drawFileList: true,
        });
      }

      res.status(200).send(
        renderDiffPage({
          title: `${repoName} · Diff`,
          repoName,
          gitInfo,
          relPathPosix: "",
          querySuffix,
          base,
          branches,
          tags,
          diffHtml,
          tooLarge: diffResult.tooLarge,
          empty: !diffResult.raw,
          fileCount,
          showAll,
        }),
      );
    } catch (e) {
      res
        .status(e.statusCode || 500)
        .send(renderErrorPage({ title: "Error", message: e.message }));
    }
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
      if (st === null) {
        const err = new Error("Permission denied");
        err.statusCode = 403;
        throw err;
      }
      if (st.isFile)
        return res.redirect(
          `/blob/${encodePathForUrl(toPosixPath(stripped))}${querySuffix}`,
        );

      let entries;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch (e) {
        if (e.code === "EACCES" || e.code === "EPERM") {
          const err = new Error("Permission denied");
          err.statusCode = 403;
          throw err;
        }
        throw e;
      }
      const readmeEntry = entries.find(
        (e) =>
          e.isFile() &&
          /^readme(?:\.(?:md|markdown|mdown|mkd|mkdn))?$/i.test(e.name),
      );
      const rows = (
        await Promise.all(
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
              if (info === null) return null;
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
                mtimeMs: info.mtimeMs,
              };
            }),
        )
      ).filter((row) => row !== null);

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
      if (st === null) {
        const err = new Error("Permission denied");
        err.statusCode = 403;
        throw err;
      }
      if (st.isDir)
        return res.redirect(
          `/tree/${encodePathForUrl(toPosixPath(stripped))}${querySuffix}`,
        );

      const fileName = path.basename(resolved);
      const ext = path.extname(fileName).toLowerCase();
      const isMarkdown = [".md", ".markdown", ".mdown", ".mkd", ".mkdn"].includes(ext);
      const isPdf = ext === ".pdf";
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(ext);
      const isCsv = [".csv", ".tsv"].includes(ext);
      const maxBytes = 2 * 1024 * 1024;
      const rawSrc = `/raw/${encodePathForUrl(toPosixPath(stripped))}`;

      if (isPdf) {
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
            mediaType: "pdf",
            renderedHtml: `<iframe class="pdf-frame" src="${rawSrc}"></iframe>`,
          }),
        );
        return;
      }

      if (isImage) {
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
            mediaType: "image",
            renderedHtml: `<img class="image-preview" src="${rawSrc}" alt="${escapeHtml(fileName)}" />`,
          }),
        );
        return;
      }

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
      let mediaType;
      if (isCsv) {
        const delimiter = ext === ".tsv" ? "\t" : ",";
        const rows = parseCsv(text, delimiter);
        renderedHtml = renderCsvTable(rows, escapeHtml);
        mediaType = "csv";
      } else if (isMarkdown) {
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
          mediaType,
          renderedHtml,
        }),
      );
    } catch (e) {
      res
        .status(e.statusCode || 500)
        .send(renderErrorPage({ title: "Error", message: e.message }));
    }
  });

  // --- Review routes ---
  const reviewDir = path.join(repoRootReal, ".repoview", "reviews");
  const THREAD_ID_RE = /^[a-zA-Z0-9_-]+$/;

  function validateThreadId(id) {
    return id && typeof id === "string" && THREAD_ID_RE.test(id);
  }

  app.get("/review/", async (req, res) => {
    try {
      let entries = [];
      try {
        entries = await fs.readdir(reviewDir, { withFileTypes: true });
      } catch {
        // no review dir yet
      }

      const threads = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const threadFile = path.join(reviewDir, entry.name, "thread.json");
        try {
          const thread = JSON.parse(await fs.readFile(threadFile, "utf8"));
          let messageCount = 0;
          let lastMessageId = null;
          try {
            const msgs = (await fs.readdir(path.join(reviewDir, entry.name, "messages")))
              .filter((f) => f.endsWith(".json"))
              .sort();
            messageCount = msgs.length;
            lastMessageId = msgs.length ? msgs[msgs.length - 1].replace(".json", "") : null;
          } catch {
            // no messages
          }
          const unreadCount = thread.readUntil && lastMessageId
            ? Math.max(0, parseInt(lastMessageId, 10) - parseInt(thread.readUntil, 10))
            : thread.readUntil ? 0 : messageCount;
          threads.push({ ...thread, messageCount, lastMessageId, unreadCount });
        } catch {
          // skip
        }
      }

      threads.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

      res.status(200).send(
        renderReviewListPage({
          title: `${repoName} · Reviews`,
          repoName,
          gitInfo,
          threads,
        }),
      );
    } catch (e) {
      res.status(500).send(renderErrorPage({ title: "Error", message: e.message }));
    }
  });

  app.get("/review/:threadId", async (req, res) => {
    try {
      const { threadId } = req.params;
      if (!validateThreadId(threadId)) {
        return res.status(400).send(renderErrorPage({ title: "Error", message: "Invalid thread ID" }));
      }

      const threadDir = path.join(reviewDir, threadId);
      const threadFile = path.join(threadDir, "thread.json");

      let thread;
      try {
        thread = JSON.parse(await fs.readFile(threadFile, "utf8"));
      } catch {
        return res.status(404).send(renderErrorPage({ title: "Error", message: "Thread not found" }));
      }

      const messagesDir = path.join(threadDir, "messages");
      let messageFiles = [];
      try {
        messageFiles = (await fs.readdir(messagesDir)).filter((f) => f.endsWith(".json")).sort();
      } catch {
        // no messages
      }

      const messages = [];
      for (const f of messageFiles) {
        messages.push(JSON.parse(await fs.readFile(path.join(messagesDir, f), "utf8")));
      }

      let comments = [];
      try {
        const commentsData = JSON.parse(await fs.readFile(path.join(threadDir, "comments.json"), "utf8"));
        comments = commentsData.comments || [];
      } catch {
        // no comments
      }

      // Render agent messages as markdown, user messages as plain text
      const renderedMessages = messages.map((msg) => {
        if (msg.role === "agent" && msg.format === "markdown") {
          return md.render(msg.body, { baseDirPosix: "", emitLineMap: true });
        }
        return msg.body;
      });

      // Mark as read
      if (messageFiles.length) {
        const lastMsgId = messageFiles[messageFiles.length - 1].replace(".json", "");
        thread.readUntil = lastMsgId;
        await fs.writeFile(threadFile, JSON.stringify(thread, null, 2) + "\n");
      }

      res.status(200).send(
        renderReviewThreadPage({
          title: `${repoName} · ${thread.title}`,
          repoName,
          gitInfo,
          thread,
          messages,
          comments,
          renderedMessages,
        }),
      );
    } catch (e) {
      res.status(500).send(renderErrorPage({ title: "Error", message: e.message }));
    }
  });

  app.post("/review/:threadId/messages", express.json(), async (req, res) => {
    try {
      const { threadId } = req.params;
      if (!validateThreadId(threadId)) {
        return res.status(400).json({ error: "Invalid thread ID" });
      }

      const threadDir = path.join(reviewDir, threadId);
      const threadFile = path.join(threadDir, "thread.json");
      const messagesDir = path.join(threadDir, "messages");

      let thread;
      try {
        thread = JSON.parse(await fs.readFile(threadFile, "utf8"));
      } catch {
        return res.status(404).json({ error: "Thread not found" });
      }

      const { body } = req.body;
      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Message body is required" });
      }

      let entries = [];
      try {
        entries = (await fs.readdir(messagesDir)).filter((f) => f.endsWith(".json"));
      } catch {
        await fs.mkdir(messagesDir, { recursive: true });
      }

      const existingIds = entries.map((e) => e.replace(".json", ""));
      let max = 0;
      for (const id of existingIds) {
        const n = parseInt(id, 10);
        if (n > max) max = n;
      }
      const nextId = String(max + 1).padStart(3, "0");
      const now = new Date().toISOString();

      const message = {
        id: nextId,
        role: "user",
        format: "text",
        body: body.trim(),
        createdAt: now,
      };

      await fs.writeFile(path.join(messagesDir, `${nextId}.json`), JSON.stringify(message, null, 2) + "\n");
      thread.lastActivityAt = now;
      await fs.writeFile(threadFile, JSON.stringify(thread, null, 2) + "\n");

      res.status(201).json(message);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/review/:threadId/comments", express.json(), async (req, res) => {
    try {
      const { threadId } = req.params;
      if (!validateThreadId(threadId)) {
        return res.status(400).json({ error: "Invalid thread ID" });
      }

      const threadDir = path.join(reviewDir, threadId);
      const commentsFile = path.join(threadDir, "comments.json");

      const { messageId, anchorLine, anchorEndLine, anchorText, body } = req.body;
      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Comment body is required" });
      }

      let commentsData = { comments: [] };
      try {
        commentsData = JSON.parse(await fs.readFile(commentsFile, "utf8"));
      } catch {
        // fresh comments
      }

      const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const comment = {
        id,
        messageId: messageId || null,
        anchorLine: anchorLine || null,
        anchorEndLine: anchorEndLine || null,
        anchorText: anchorText || null,
        body: body.trim(),
        createdAt: new Date().toISOString(),
        resolved: false,
      };

      commentsData.comments.push(comment);
      await fs.writeFile(commentsFile, JSON.stringify(commentsData, null, 2) + "\n");

      res.status(201).json(comment);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/review/:threadId/comments/:commentId", express.json(), async (req, res) => {
    try {
      const { threadId, commentId } = req.params;
      if (!validateThreadId(threadId)) {
        return res.status(400).json({ error: "Invalid thread ID" });
      }

      const commentsFile = path.join(reviewDir, threadId, "comments.json");

      let commentsData;
      try {
        commentsData = JSON.parse(await fs.readFile(commentsFile, "utf8"));
      } catch {
        return res.status(404).json({ error: "Comments not found" });
      }

      const comment = commentsData.comments.find((c) => c.id === commentId);
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      if (req.body.resolved !== undefined) comment.resolved = req.body.resolved;
      if (req.body.body !== undefined) comment.body = req.body.body;

      await fs.writeFile(commentsFile, JSON.stringify(commentsData, null, 2) + "\n");
      res.status(200).json(comment);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/review/:threadId/comments/:commentId", async (req, res) => {
    try {
      const { threadId, commentId } = req.params;
      if (!validateThreadId(threadId)) {
        return res.status(400).json({ error: "Invalid thread ID" });
      }

      const commentsFile = path.join(reviewDir, threadId, "comments.json");

      let commentsData;
      try {
        commentsData = JSON.parse(await fs.readFile(commentsFile, "utf8"));
      } catch {
        return res.status(404).json({ error: "Comments not found" });
      }

      const idx = commentsData.comments.findIndex((c) => c.id === commentId);
      if (idx === -1) {
        return res.status(404).json({ error: "Comment not found" });
      }

      commentsData.comments.splice(idx, 1);
      await fs.writeFile(commentsFile, JSON.stringify(commentsData, null, 2) + "\n");
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/review/:threadId/mark-read", express.json(), async (req, res) => {
    try {
      const { threadId } = req.params;
      if (!validateThreadId(threadId)) {
        return res.status(400).json({ error: "Invalid thread ID" });
      }

      const threadFile = path.join(reviewDir, threadId, "thread.json");
      let thread;
      try {
        thread = JSON.parse(await fs.readFile(threadFile, "utf8"));
      } catch {
        return res.status(404).json({ error: "Thread not found" });
      }

      const { readUntil } = req.body;
      if (readUntil) thread.readUntil = readUntil;
      await fs.writeFile(threadFile, JSON.stringify(thread, null, 2) + "\n");
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Code context API for inline code popups ---
  app.get("/api/code-context", async (req, res) => {
    try {
      const filePath = req.query.file;
      if (!filePath || typeof filePath !== "string") {
        return res.status(400).json({ error: "file parameter required" });
      }
      const line = parseInt(req.query.line, 10) || 1;
      const endLine = parseInt(req.query.endLine, 10) || line;
      const context = Math.min(parseInt(req.query.context, 10) || 20, 200);

      const { resolved, stripped } = await safeRealpath(repoRootReal, filePath);
      const st = await statSafe(resolved);
      if (!st || !st.isFile) {
        return res.status(404).json({ error: "File not found" });
      }
      if (st.size > 2 * 1024 * 1024) {
        return res.status(400).json({ error: "File too large" });
      }

      const raw = await fs.readFile(resolved, "utf8");
      const allLines = raw.split("\n");

      const startLine = Math.max(1, Math.min(line, endLine) - context);
      const stopLine = Math.min(allLines.length, Math.max(line, endLine) + context);
      const snippet = allLines.slice(startLine - 1, stopLine);

      const ext = path.extname(stripped).slice(1);

      // Get diff for this file (against HEAD)
      let diff = null;
      const diffResult = await execGit(repoRootReal, ["diff", "HEAD", "--", stripped], 256 * 1024);
      if (diffResult.output) {
        diff = diffResult.output;
      }

      res.json({
        file: toPosixPath(stripped),
        startLine,
        stopLine,
        highlightStart: Math.min(line, endLine),
        highlightEnd: Math.max(line, endLine),
        lines: snippet,
        language: ext,
        totalLines: allLines.length,
        diff,
      });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  app.get(["/raw/*", "/raw"], async (req, res) => {
    try {
      const p = req.params[0] ?? "";
      const { resolved } = await safeRealpath(repoRootReal, p);
      const st = await statSafe(resolved);
      if (st === null) {
        const err = new Error("Permission denied");
        err.statusCode = 403;
        throw err;
      }
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
        /(^|[/\\])\.repoview([/\\]|$)/,
      ],
      ignoreInitial: true,
      ignorePermissionErrors: true,
    });
    watcher.on("error", () => {
      // Silently ignore watch errors (e.g., permission denied)
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
  console.log(`repoview: ${repoRootReal}`);
  // eslint-disable-next-line no-console
  console.log(`listening: http://${host}:${port}`);
}
