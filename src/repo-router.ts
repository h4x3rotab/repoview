import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import type { Request, Response } from "express";
import mime from "mime-types";
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
import { toPosixPath, encodePathForUrl, safeRealpath, statSafe } from "./paths.js";
import type { HttpError } from "./paths.js";
import type { RepoContext } from "./types.js";
import type { Session } from "./session.js";
import { formatBytes, formatDate } from "./format.js";
import { parseCsv, renderCsvTable } from "./csv.js";
import {
  validateGitRef,
  getGitBranches,
  getGitTags,
  getGitDiffRaw,
  execGit,
} from "./git.js";

const THREAD_ID_RE = /^[a-zA-Z0-9_-]+$/;

function qstr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function validateThreadId(id: unknown): boolean {
  return !!id && typeof id === "string" && THREAD_ID_RE.test(id);
}

/**
 * Build an express.Router serving a single repo (the given context). All
 * generated app URLs are prefixed with `repoBase` (e.g. "/r/myrepo").
 */
function buildRepoRouter(ctx: RepoContext, repoBase: string, session: Session) {
  const { md } = ctx;
  const router = express.Router();

  const errorPage = (title: string, message: string) =>
    renderErrorPage({ title, message, repoBase, repos: session.listRepos(), currentRepoId: ctx.id });

  router.get("/rev", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send({ revision: ctx.reloadHub.getRevision() });
  });

  router.get("/broken-links.json", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(ctx.linkScanner.getState());
  });

  router.get("/broken-links", (req: Request, res: Response) => {
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
    const toggleIgnoredHref = `${repoBase}/broken-links${toggleIgnoredSuffix}`;
    const state = ctx.linkScanner.getState();
    res.status(200).send(
      renderBrokenLinksPage({
        title: `${ctx.repoName} · Broken links`,
        repoName: ctx.repoName,
        gitInfo: ctx.gitInfo,
        relPathPosix: "",
        scanState: state,
        querySuffix,
        toggleIgnoredHref,
        showIgnored,
        repoBase,
        repos: session.listRepos(),
        currentRepoId: ctx.id,
      }),
    );
  });

  router.get("/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write("event: hello\ndata: ok\n\n");
    ctx.reloadHub.add(res);

    const interval = setInterval(() => {
      try {
        res.write(":\n\n");
        ctx.reloadHub.broadcastPing();
      } catch {
        // ignore
      }
    }, 15000);
    res.on("close", () => clearInterval(interval));
  });

  router.get("/diff", async (req: Request, res: Response) => {
    try {
      const base = qstr(req.query.base) || "HEAD";
      if (!validateGitRef(base)) {
        const err: HttpError = new Error("Invalid base ref");
        err.statusCode = 400;
        throw err;
      }

      if (!ctx.gitInfo.commit) {
        const err: HttpError = new Error("Not a git repository");
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
        getGitBranches(ctx.repoRootReal),
        getGitTags(ctx.repoRootReal),
        getGitDiffRaw(ctx.repoRootReal, base),
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
          title: `${ctx.repoName} · Diff`,
          repoName: ctx.repoName,
          gitInfo: ctx.gitInfo,
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
          repoBase,
          repos: session.listRepos(),
          currentRepoId: ctx.id,
        }),
      );
    } catch (e) {
      const err = e as HttpError;
      res
        .status(err.statusCode || 500)
        .send(errorPage("Error", (e as { message?: string }).message ?? "Error"));
    }
  });

  router.get(["/tree/*", "/tree"], async (req: Request, res: Response) => {
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
      const { stripped, resolved } = await safeRealpath(ctx.repoRootReal, p);
      const toggleIgnoredHref = `${repoBase}/tree/${encodePathForUrl(
        toPosixPath(stripped),
      )}${toggleIgnoredSuffix}`;
      const st = await statSafe(resolved);
      if (st === null) {
        const err: HttpError = new Error("Permission denied");
        err.statusCode = 403;
        throw err;
      }
      if (st.isFile)
        return res.redirect(
          `${repoBase}/blob/${encodePathForUrl(toPosixPath(stripped))}${querySuffix}`,
        );

      let entries;
      try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EACCES" || (e as NodeJS.ErrnoException).code === "EPERM") {
          const err: HttpError = new Error("Permission denied");
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
              return !ctx.ignoreMatcher.ignores(relPosix, { isDir: e.isDirectory() });
            })
            .map(async (e) => {
              const relPosix = toPosixPath(path.posix.join(toPosixPath(stripped), e.name));
              const full = path.join(resolved, e.name);
              const info = await statSafe(full, { followSymlinks: false });
              if (info === null) return null;
              const isDir = e.isDirectory();
              const href = isDir
                ? `${repoBase}/tree/${encodePathForUrl(relPosix)}${querySuffix}`
                : `${repoBase}/blob/${encodePathForUrl(relPosix)}${querySuffix}`;
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
          if (!showIgnored && ctx.ignoreMatcher.ignores(readmeRel, { isDir: false }))
            throw new Error("ignored");
          const { resolved: readmePath } = await safeRealpath(ctx.repoRootReal, readmeRel);
          const readmeStat = await statSafe(readmePath);
          if (readmeStat && readmeStat.size <= 2 * 1024 * 1024) {
            const buf = await fs.readFile(readmePath);
            readmeHtml = md.render(buf.toString("utf8"), {
              baseDirPosix: toPosixPath(stripped),
              repoBase,
            });
          }
        } catch {
          readmeHtml = "";
        }
      }

      res.status(200).send(
        renderTreePage({
          title: `${ctx.repoName}${stripped ? `/${stripped}` : ""}`,
          repoName: ctx.repoName,
          gitInfo: ctx.gitInfo,
          brokenLinks: ctx.linkScanner.getState(),
          relPathPosix: toPosixPath(stripped),
          querySuffix,
          toggleIgnoredHref,
          showIgnored,
          rows,
          readmeHtml,
          repoBase,
          repos: session.listRepos(),
          currentRepoId: ctx.id,
        }),
      );
    } catch (e) {
      const err = e as HttpError;
      res
        .status(err.statusCode || 500)
        .send(errorPage("Error", (e as { message?: string }).message ?? "Error"));
    }
  });

  router.get(["/blob/*", "/blob"], async (req: Request, res: Response) => {
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
      const { stripped, resolved } = await safeRealpath(ctx.repoRootReal, p);
      const toggleIgnoredHref = `${repoBase}/blob/${encodePathForUrl(
        toPosixPath(stripped),
      )}${toggleIgnoredSuffix}`;
      const st = await statSafe(resolved);
      if (st === null) {
        const err: HttpError = new Error("Permission denied");
        err.statusCode = 403;
        throw err;
      }
      if (st.isDir)
        return res.redirect(
          `${repoBase}/tree/${encodePathForUrl(toPosixPath(stripped))}${querySuffix}`,
        );

      const fileName = path.basename(resolved);
      const ext = path.extname(fileName).toLowerCase();
      const isMarkdown = [".md", ".markdown", ".mdown", ".mkd", ".mkdn"].includes(ext);
      const isPdf = ext === ".pdf";
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(ext);
      const isCsv = [".csv", ".tsv"].includes(ext);
      const maxBytes = 2 * 1024 * 1024;
      const rawSrc = `${repoBase}/raw/${encodePathForUrl(toPosixPath(stripped))}`;

      if (isPdf) {
        res.status(200).send(
          renderFilePage({
            title: `${ctx.repoName}/${stripped}`,
            repoName: ctx.repoName,
            gitInfo: ctx.gitInfo,
            brokenLinks: ctx.linkScanner.getState(),
            relPathPosix: toPosixPath(stripped),
            querySuffix,
            toggleIgnoredHref,
            showIgnored,
            fileName,
            isMarkdown: false,
            mediaType: "pdf",
            renderedHtml: `<iframe class="pdf-frame" src="${rawSrc}"></iframe>`,
            repoBase,
            repos: session.listRepos(),
            currentRepoId: ctx.id,
          }),
        );
        return;
      }

      if (isImage) {
        res.status(200).send(
          renderFilePage({
            title: `${ctx.repoName}/${stripped}`,
            repoName: ctx.repoName,
            gitInfo: ctx.gitInfo,
            brokenLinks: ctx.linkScanner.getState(),
            relPathPosix: toPosixPath(stripped),
            querySuffix,
            toggleIgnoredHref,
            showIgnored,
            fileName,
            isMarkdown: false,
            mediaType: "image",
            renderedHtml: `<img class="image-preview" src="${rawSrc}" alt="${escapeHtml(fileName)}" />`,
            repoBase,
            repos: session.listRepos(),
            currentRepoId: ctx.id,
          }),
        );
        return;
      }

      if (st.size > maxBytes) {
        res.status(200).send(
          renderFilePage({
            title: `${ctx.repoName}/${stripped}`,
            repoName: ctx.repoName,
            gitInfo: ctx.gitInfo,
            brokenLinks: ctx.linkScanner.getState(),
            relPathPosix: toPosixPath(stripped),
            querySuffix,
            toggleIgnoredHref,
            showIgnored,
            fileName,
            isMarkdown: false,
            renderedHtml: `<div class="note">File is too large to render (${formatBytes(
              st.size,
            )}). Use <a href="${repoBase}/raw/${encodePathForUrl(
              toPosixPath(stripped),
            )}${querySuffix}">Raw</a>.</div>`,
            repoBase,
            repos: session.listRepos(),
            currentRepoId: ctx.id,
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
        renderedHtml = md.render(text, { baseDirPosix: baseDir === "." ? "" : baseDir, repoBase });
      } else {
        renderedHtml = md.renderCodeBlock(text, {
          languageHint: ext ? ext.slice(1) : "",
        });
      }

      res.status(200).send(
        renderFilePage({
          title: `${ctx.repoName}/${stripped}`,
          repoName: ctx.repoName,
          gitInfo: ctx.gitInfo,
          brokenLinks: ctx.linkScanner.getState(),
          relPathPosix: toPosixPath(stripped),
          querySuffix,
          toggleIgnoredHref,
          showIgnored,
          fileName,
          isMarkdown,
          mediaType,
          renderedHtml,
          repoBase,
          repos: session.listRepos(),
          currentRepoId: ctx.id,
        }),
      );
    } catch (e) {
      const err = e as HttpError;
      res
        .status(err.statusCode || 500)
        .send(errorPage("Error", (e as { message?: string }).message ?? "Error"));
    }
  });

  // --- Review routes ---
  const reviewDir = ctx.reviewDir;

  router.get("/review/", async (req: Request, res: Response) => {
    try {
      let entries: import("node:fs").Dirent[] = [];
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

      threads.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

      res.status(200).send(
        renderReviewListPage({
          title: `${ctx.repoName} · Reviews`,
          repoName: ctx.repoName,
          gitInfo: ctx.gitInfo,
          threads,
          repoBase,
          repos: session.listRepos(),
          currentRepoId: ctx.id,
        }),
      );
    } catch (e) {
      res.status(500).send(errorPage("Error", (e as { message?: string }).message ?? "Error"));
    }
  });

  router.get("/review/:threadId", async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      if (!validateThreadId(threadId)) {
        return res.status(400).send(errorPage("Error", "Invalid thread ID"));
      }

      const threadDir = path.join(reviewDir, threadId);
      const threadFile = path.join(threadDir, "thread.json");

      let thread;
      try {
        thread = JSON.parse(await fs.readFile(threadFile, "utf8"));
      } catch {
        return res.status(404).send(errorPage("Error", "Thread not found"));
      }

      const messagesDir = path.join(threadDir, "messages");
      let messageFiles: string[] = [];
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
          return md.render(msg.body, { baseDirPosix: "", emitLineMap: true, repoBase });
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
          title: `${ctx.repoName} · ${thread.title}`,
          repoName: ctx.repoName,
          gitInfo: ctx.gitInfo,
          thread,
          messages,
          comments,
          renderedMessages,
          repoBase,
          repos: session.listRepos(),
          currentRepoId: ctx.id,
        }),
      );
    } catch (e) {
      res.status(500).send(errorPage("Error", (e as { message?: string }).message ?? "Error"));
    }
  });

  router.post("/review/:threadId/messages", express.json(), async (req: Request, res: Response) => {
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

      let entries: string[] = [];
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
      res.status(500).json({ error: (e as HttpError).message });
    }
  });

  router.post("/review/:threadId/comments", express.json(), async (req: Request, res: Response) => {
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

      let commentsData: { comments: any[] } = { comments: [] };
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
      res.status(500).json({ error: (e as HttpError).message });
    }
  });

  router.patch("/review/:threadId/comments/:commentId", express.json(), async (req: Request, res: Response) => {
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

      const comment = commentsData.comments.find((c: any) => c.id === commentId);
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      if (req.body.resolved !== undefined) comment.resolved = req.body.resolved;
      if (req.body.body !== undefined) comment.body = req.body.body;

      await fs.writeFile(commentsFile, JSON.stringify(commentsData, null, 2) + "\n");
      res.status(200).json(comment);
    } catch (e) {
      res.status(500).json({ error: (e as HttpError).message });
    }
  });

  router.delete("/review/:threadId/comments/:commentId", async (req: Request, res: Response) => {
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

      const idx = commentsData.comments.findIndex((c: any) => c.id === commentId);
      if (idx === -1) {
        return res.status(404).json({ error: "Comment not found" });
      }

      commentsData.comments.splice(idx, 1);
      await fs.writeFile(commentsFile, JSON.stringify(commentsData, null, 2) + "\n");
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as HttpError).message });
    }
  });

  router.post("/review/:threadId/mark-read", express.json(), async (req: Request, res: Response) => {
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
      res.status(500).json({ error: (e as HttpError).message });
    }
  });

  // --- Code context API for inline code popups ---
  router.get("/api/code-context", async (req: Request, res: Response) => {
    try {
      const filePath = req.query.file;
      if (!filePath || typeof filePath !== "string") {
        return res.status(400).json({ error: "file parameter required" });
      }
      const line = parseInt(qstr(req.query.line) ?? "", 10) || 1;
      const endLine = parseInt(qstr(req.query.endLine) ?? "", 10) || line;
      const context = Math.min(parseInt(qstr(req.query.context) ?? "", 10) || 20, 200);

      const { resolved, stripped } = await safeRealpath(ctx.repoRootReal, filePath);
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
      const diffResult = await execGit(ctx.repoRootReal, ["diff", "HEAD", "--", stripped], 256 * 1024);
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
      const err = e as HttpError;
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  router.get(["/raw/*", "/raw"], async (req: Request, res: Response) => {
    try {
      const p = req.params[0] ?? "";
      const { resolved } = await safeRealpath(ctx.repoRootReal, p);
      const st = await statSafe(resolved);
      if (st === null) {
        const err: HttpError = new Error("Permission denied");
        err.statusCode = 403;
        throw err;
      }
      if (!st.isFile) {
        const err: HttpError = new Error("Not a file");
        err.statusCode = 400;
        throw err;
      }

      const contentType = mime.contentType(path.extname(resolved)) || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.sendFile(resolved);
    } catch (e) {
      const err = e as HttpError;
      res
        .status(err.statusCode || 500)
        .send(errorPage("Error", (e as { message?: string }).message ?? "Error"));
    }
  });

  return router;
}

/**
 * Build a parent router serving every repo in the session under
 * `/r/:repoId/...`. Each repo's child router is built lazily and cached.
 */
export function createReposRouter(session: Session) {
  const cache = new WeakMap<RepoContext, express.Router>();
  const parent = express.Router();
  parent.use("/:repoId", (req, res, next) => {
    const ctx = session.getRepo(req.params.repoId);
    if (!ctx) {
      return res.status(404).send(
        renderErrorPage({
          title: "Not found",
          message: `Unknown repo: ${req.params.repoId}`,
          repoBase: "",
          repos: session.listRepos(),
          currentRepoId: "",
        }),
      );
    }
    let child = cache.get(ctx);
    if (!child) {
      child = buildRepoRouter(ctx, `/r/${ctx.id}`, session);
      cache.set(ctx, child);
    }
    return child(req, res, next);
  });
  return parent;
}
