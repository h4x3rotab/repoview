import path from "node:path";
import type { GitInfo, ScanState, RepoSummary } from "./types.js";

function renderRepoSwitcher(
  repos: RepoSummary[],
  currentRepoId: string,
  repoName: string,
): string {
  if (repos.length < 1) return "";
  const current = repos.find((r) => r.id === currentRepoId);
  const currentName = current ? current.name : repoName;
  return `<details class="repo-switcher">
  <summary class="pill link">${escapeHtml(currentName)} ▾</summary>
  <div class="menu-panel" role="menu">
    ${repos
      .map(
        (r) =>
          `<a class="menu-item link${r.id === currentRepoId ? " current" : ""}" role="menuitem" href="/r/${encodeURIComponent(r.id)}/tree/">${escapeHtml(r.name)}</a>`,
      )
      .join("")}
    <a class="menu-item link manage" role="menuitem" href="/session">⚙ Manage repos…</a>
  </div>
</details>`;
}

interface SessionPageOptions {
  repos: RepoSummary[];
  version?: string;
  notice?: string;
  /** Whether the requester may add/remove repos (loopback only). */
  canManage?: boolean;
}

export function renderSessionPage({
  repos,
  version,
  notice,
  canManage = true,
}: SessionPageOptions): string {
  const actionCol = canManage ? "<th></th>" : "";
  const colspan = canManage ? 4 : 3;
  const rows = repos.length
    ? repos
        .map(
          (r) => `<tr>
        <td><a class="link" href="/r/${encodeURIComponent(r.id)}/tree/">${escapeHtml(r.name)}</a></td>
        <td><span class="pill mono">${escapeHtml(r.branch || "no-git")}</span></td>
        <td class="session-path mono">${escapeHtml(r.path)}</td>
        ${canManage ? `<td><button class="btn btn-sm repo-remove" data-id="${escapeHtml(r.id)}">Remove</button></td>` : ""}
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="${colspan}" class="muted">No repositories registered.${canManage ? " Add one below." : ""}</td></tr>`;

  const addCard = canManage
    ? `<div class="card">
        <h2 class="card-title">Add a repository</h2>
        <form id="add-repo-form" class="session-add">
          <input id="add-repo-path" type="text" placeholder="/absolute/path/to/repo" autocomplete="off" />
          <button class="btn" type="submit">Add</button>
        </form>
        <p class="muted" id="add-repo-error"></p>
      </div>`
    : `<p class="muted">Repositories can only be added or removed from the host machine (localhost).</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>repoview · session</title>
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body data-repo-base="">
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="/session">repoview</a>
        <div class="meta"><span class="pill">session</span></div>
      </div>
    </header>
    <main class="container">
      ${notice ? `<div class="note">${escapeHtml(notice)}</div>` : ""}
      <div class="card">
        <h2 class="card-title">Repositories</h2>
        <table class="session-table">
          <thead><tr><th>Name</th><th>Branch</th><th>Path</th>${actionCol}</tr></thead>
          <tbody id="repo-rows">${rows}</tbody>
        </table>
      </div>
      ${addCard}
      ${version ? `<p class="muted">repoview v${escapeHtml(version)}</p>` : ""}
    </main>
    ${canManage ? `<script type="module" src="/static/session.js"></script>` : ""}
  </body>
</html>`;
}

function formatReviewTime(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function escapeHtml(s: unknown): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function encodePathForUrl(posixPath: string): string {
  return posixPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

interface Crumb {
  name: string;
  href: string;
}

function renderBreadcrumbs(
  relPathPosix: string | null | undefined,
  querySuffix: string | null | undefined,
  repoBase: string,
): string {
  const parts = (relPathPosix || "").split("/").filter(Boolean);
  const suffix = querySuffix || "";
  const crumbs: Crumb[] = [{ name: "", href: `${repoBase}/tree/${suffix}` }];
  let cursor = "";
  for (const p of parts) {
    cursor = cursor ? `${cursor}/${p}` : p;
    crumbs.push({ name: p, href: `${repoBase}/tree/${encodePathForUrl(cursor)}${suffix}` });
  }

  const html = crumbs
    .map((c, idx) => {
      const label = idx === 0 ? "root" : escapeHtml(c.name);
      return `<a class="crumb" href="${c.href}">${label}</a>`;
    })
    .join(`<span class="crumb-sep">/</span>`);
  return `<nav class="breadcrumbs" aria-label="Breadcrumbs">${html}</nav>`;
}

interface PageTemplateOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  relPathPosix: string;
  bodyHtml: string;
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

function pageTemplate({
  title,
  repoName,
  gitInfo,
  relPathPosix,
  bodyHtml,
  repoBase,
  repos,
  currentRepoId,
}: PageTemplateOptions): string {
  const branch = gitInfo?.branch ? escapeHtml(gitInfo.branch) : "no-git";
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";
  const repoSwitcher = renderRepoSwitcher(repos, currentRepoId, repoName);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/vendor/github-markdown-css/github-markdown.css" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github.css" media="(prefers-color-scheme: light)" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github-dark.css" media="(prefers-color-scheme: dark)" />
    <link rel="stylesheet" href="/static/vendor/katex/katex.min.css" />
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body data-repo-base="${escapeHtml(repoBase)}">
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="${repoBase}/tree/">${escapeHtml(repoName)}</a>
        ${repoSwitcher}
        <div class="meta">
          <span class="pill">${branch}</span>
          ${commit ? `<span class="pill mono">${commit}</span>` : ""}
        </div>
      </div>
      ${renderBreadcrumbs(relPathPosix, "", repoBase)}
    </header>
    <main class="container">
      ${bodyHtml}
    </main>
    <script defer src="/static/vendor/katex/katex.min.js"></script>
    <script defer src="/static/vendor/katex/contrib/auto-render.min.js"></script>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>`;
}

function renderBrokenLinksPill(
  brokenLinks: ScanState | null | undefined,
  querySuffix: string | null | undefined,
  repoBase: string,
): string {
  const state = brokenLinks;
  if (!state) return "";
  const status = state.status;
  const count = state.lastResult?.broken?.length ?? 0;
  const href = `${repoBase}/broken-links${querySuffix || ""}`;
  if (status === "running") return `<a class="pill link" href="${href}">Scanning links…</a>`;
  if (state.lastResult) {
    return `<a class="pill link" href="${href}">Broken: ${count}</a>`;
  }
  if (state.lastError) return `<a class="pill link" href="${href}">Broken: ?</a>`;
  return "";
}

interface IgnoredToggleOptions {
  toggleIgnoredHref: string | null | undefined;
  showIgnored: boolean;
}

function renderIgnoredTogglePill({ toggleIgnoredHref, showIgnored }: IgnoredToggleOptions): string {
  const href = toggleIgnoredHref || "#";
  const label = showIgnored ? "Ignored: on" : "Ignored: off";
  return `<a class="pill link" data-no-preserve="ignored" href="${href}">${label}</a>`;
}

interface MetaMenuOptions {
  gitInfo: GitInfo | null;
  brokenLinks: ScanState | null | undefined;
  querySuffix: string | null | undefined;
  toggleIgnoredHref: string | null | undefined;
  showIgnored: boolean;
  repoBase: string;
}

function renderMetaMenu({
  gitInfo,
  brokenLinks,
  querySuffix,
  toggleIgnoredHref,
  showIgnored,
  repoBase,
}: MetaMenuOptions): string {
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";
  const brokenState = brokenLinks;
  const brokenCount = brokenState?.lastResult?.broken?.length ?? null;
  const brokenLabel =
    brokenState?.status === "running"
      ? "Broken links: scanning…"
      : brokenCount == null
        ? "Broken links"
        : `Broken links: ${brokenCount}`;
  const brokenHref = `${repoBase}/broken-links${querySuffix || ""}`;
  const ignoredHref = toggleIgnoredHref || "#";
  const ignoredLabel = showIgnored ? "Hide ignored files" : "Show ignored files";

  const diffHref = `${repoBase}/diff${querySuffix || ""}`;

  return `<details class="meta-menu">
  <summary class="pill link" aria-label="More">More</summary>
  <div class="menu-panel" role="menu">
    <a class="menu-item link" href="${diffHref}" role="menuitem">Diff view</a>
    <a class="menu-item link" href="${repoBase}/review/" role="menuitem">Reviews</a>
    <a class="menu-item link" href="${brokenHref}" role="menuitem">${escapeHtml(brokenLabel)}</a>
    <a class="menu-item link" data-no-preserve="ignored" href="${ignoredHref}" role="menuitem">${escapeHtml(
      ignoredLabel,
    )}</a>
    ${commit ? `<div class="menu-item mono" role="menuitem">Commit: ${commit}</div>` : ""}
  </div>
</details>`;
}

interface PageTemplateWithLinksOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  relPathPosix: string | null | undefined;
  bodyHtml: string;
  brokenLinks: ScanState | null | undefined;
  querySuffix: string | null | undefined;
  toggleIgnoredHref: string | null | undefined;
  showIgnored: boolean;
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

function pageTemplateWithLinks({
  title,
  repoName,
  gitInfo,
  relPathPosix,
  bodyHtml,
  brokenLinks,
  querySuffix,
  toggleIgnoredHref,
  showIgnored,
  repoBase,
  repos,
  currentRepoId,
}: PageTemplateWithLinksOptions): string {
  const branch = gitInfo?.branch ? escapeHtml(gitInfo.branch) : "no-git";
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";
  const brokenPill = renderBrokenLinksPill(brokenLinks, querySuffix, repoBase);
  const ignoredPill = renderIgnoredTogglePill({ toggleIgnoredHref, showIgnored });
  const metaMenu = renderMetaMenu({ gitInfo, brokenLinks, querySuffix, toggleIgnoredHref, showIgnored, repoBase });
  const repoSwitcher = renderRepoSwitcher(repos, currentRepoId, repoName);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/vendor/github-markdown-css/github-markdown.css" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github.css" media="(prefers-color-scheme: light)" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github-dark.css" media="(prefers-color-scheme: dark)" />
    <link rel="stylesheet" href="/static/vendor/katex/katex.min.css" />
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body data-repo-base="${escapeHtml(repoBase)}">
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="${repoBase}/tree/${querySuffix || ""}">${escapeHtml(repoName)}</a>
        ${repoSwitcher}
        <div class="meta">
          <span class="pill">${branch}</span>
          ${commit ? `<span class="pill mono meta-commit">${commit}</span>` : ""}
          <span class="meta-actions">
            <a class="pill link" href="${repoBase}/diff${querySuffix || ""}">Diff</a>
            <a class="pill link" href="${repoBase}/review/">Review</a>
            ${brokenPill}
            ${ignoredPill}
          </span>
          <span id="conn-status" class="conn-status" title="Live reload: connecting..."></span>
          ${metaMenu}
        </div>
      </div>
      ${renderBreadcrumbs(relPathPosix, querySuffix, repoBase)}
    </header>
    <main class="container">
      ${bodyHtml}
    </main>
    <script defer src="/static/vendor/katex/katex.min.js"></script>
    <script defer src="/static/vendor/katex/contrib/auto-render.min.js"></script>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>`;
}

interface TreeRow {
  isDir: boolean;
  name: string;
  href: string;
  mtime: string;
  mtimeMs?: number | null;
  size: string;
}

interface TreePageOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  brokenLinks: ScanState | null | undefined;
  querySuffix: string | null | undefined;
  toggleIgnoredHref: string | null | undefined;
  showIgnored: boolean;
  relPathPosix: string | null | undefined;
  rows: TreeRow[];
  readmeHtml: string | null | undefined;
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

export function renderTreePage({
  title,
  repoName,
  gitInfo,
  brokenLinks,
  querySuffix,
  toggleIgnoredHref,
  showIgnored,
  relPathPosix,
  rows,
  readmeHtml,
  repoBase,
  repos,
  currentRepoId,
}: TreePageOptions): string {
  const tableRows = rows
    .map((r) => {
      const icon = r.isDir ? "dir" : "file";
      const name = escapeHtml(r.name);
      const tsAttr = r.mtimeMs ? ` data-ts="${r.mtimeMs}"` : "";
      return `<tr>
  <td class="name"><a class="item ${icon}" href="${r.href}">${name}</a></td>
  <td class="mtime"${tsAttr}>${escapeHtml(r.mtime)}</td>
  <td class="size">${escapeHtml(r.size)}</td>
</tr>`;
    })
    .join("\n");

  const readmeSection = readmeHtml
    ? `<section class="panel readme">
  <div class="panel-title">README</div>
  <div class="markdown-body markdown-wrap">${readmeHtml}</div>
</section>`
    : "";

  const body = `<section class="panel">
  <div class="panel-title">Files</div>
  <div class="table-wrap">
    <table class="file-table">
      <thead>
        <tr><th class="name">Name</th><th class="mtime">Last modified <button type="button" class="tz-toggle" title="Toggle local/UTC time">Local</button></th><th class="size">Size</th></tr>
      </thead>
      <tbody>
        ${tableRows || `<tr><td colspan="3" class="empty">Empty directory</td></tr>`}
      </tbody>
    </table>
  </div>
</section>
${readmeSection}`;

  return pageTemplateWithLinks({
    title,
    repoName,
    gitInfo,
    brokenLinks,
    toggleIgnoredHref,
    showIgnored,
    querySuffix,
    relPathPosix,
    bodyHtml: body,
    repoBase,
    repos,
    currentRepoId,
  });
}

interface FilePageOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  brokenLinks: ScanState | null | undefined;
  querySuffix: string | null | undefined;
  toggleIgnoredHref: string | null | undefined;
  showIgnored: boolean;
  relPathPosix: string | null | undefined;
  fileName: string;
  isMarkdown: boolean;
  mediaType?: string | null;
  renderedHtml: string;
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

export function renderFilePage({
  title,
  repoName,
  gitInfo,
  brokenLinks,
  querySuffix,
  toggleIgnoredHref,
  showIgnored,
  relPathPosix,
  fileName,
  isMarkdown,
  mediaType,
  renderedHtml,
  repoBase,
  repos,
  currentRepoId,
}: FilePageOptions): string {
  const relDir = path.posix.dirname(relPathPosix || "");
  const suffix = querySuffix || "";
  const rawHref = `${repoBase}/raw/${encodePathForUrl(relPathPosix || "")}${suffix}`;
  const treeHref = `${repoBase}/tree/${encodePathForUrl(relDir === "." ? "" : relDir)}${suffix}`;

  const wrapClass = mediaType ? `${mediaType}-wrap` : isMarkdown ? "markdown-body markdown-wrap" : "code-wrap";
  const body = `<section class="panel">
  <div class="panel-title">
    <span class="filename">${escapeHtml(fileName)}</span>
    <span class="spacer"></span>
    <a class="btn" href="${treeHref}">Back</a>
    <a class="btn" href="${rawHref}">Raw</a>
  </div>
  <div class="${wrapClass}">
    ${renderedHtml}
  </div>
</section>`;

  return pageTemplateWithLinks({
    title,
    repoName,
    gitInfo,
    brokenLinks,
    toggleIgnoredHref,
    showIgnored,
    querySuffix,
    relPathPosix,
    bodyHtml: body,
    repoBase,
    repos,
    currentRepoId,
  });
}

interface DiffPageOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  relPathPosix: string | null | undefined;
  querySuffix: string | null | undefined;
  base: string;
  branches: string[];
  tags: string[];
  diffHtml: string;
  tooLarge: boolean;
  empty: boolean;
  fileCount: number;
  showAll: boolean;
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

export function renderDiffPage({
  title,
  repoName,
  gitInfo,
  relPathPosix,
  querySuffix,
  base,
  branches,
  tags,
  diffHtml,
  tooLarge,
  empty,
  fileCount,
  showAll,
  repoBase,
  repos,
  currentRepoId,
}: DiffPageOptions): string {
  const branchOptions = branches
    .map((b) => {
      const sel = b === base ? " selected" : "";
      return `<option value="${escapeHtml(b)}"${sel}>${escapeHtml(b)}</option>`;
    })
    .join("\n");
  const tagOptions = tags
    .map((t) => {
      const sel = t === base ? " selected" : "";
      return `<option value="${escapeHtml(t)}"${sel}>${escapeHtml(t)}</option>`;
    })
    .join("\n");
  const headSelected = base === "HEAD" ? " selected" : "";

  const selector = `<select id="base-selector" class="base-selector">
    <option value="HEAD"${headSelected}>HEAD</option>
    ${branches.length ? `<optgroup label="Branches">${branchOptions}</optgroup>` : ""}
    ${tags.length ? `<optgroup label="Tags">${tagOptions}</optgroup>` : ""}
  </select>`;

  let content = "";
  if (tooLarge) {
    content = `<div class="diff-empty note">Diff output exceeded 512KB and was truncated. Try narrowing the comparison range.</div>`;
  } else if (empty) {
    content = `<div class="diff-empty note">No changes found.</div>`;
  } else {
    content = diffHtml;
  }

  const MAX_DIFF_FILES = 30;
  let truncatedMsg = "";
  if (fileCount > MAX_DIFF_FILES && !showAll) {
    const hidden = fileCount - MAX_DIFF_FILES;
    const showAllQuery = new URLSearchParams(querySuffix ? querySuffix.slice(1) : "");
    showAllQuery.set("show_all", "1");
    const showAllHref = `${repoBase}/diff?${showAllQuery.toString()}`;
    truncatedMsg = `<div class="diff-truncated note">${hidden} more file${hidden === 1 ? "" : "s"} not shown. <a class="link" href="${showAllHref}">Show all ${fileCount} files</a></div>`;
  }

  const body = `<section class="panel">
  <div class="panel-title">
    <span>Compare working tree against</span>
    ${selector}
    <span class="spacer"></span>
    <a class="btn" href="${repoBase}/tree/${querySuffix || ""}">Back</a>
  </div>
  <div class="diff-wrap">
    ${content}
    ${truncatedMsg}
  </div>
</section>`;

  const branch = gitInfo?.branch ? escapeHtml(gitInfo.branch) : "no-git";
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";
  const repoSwitcher = renderRepoSwitcher(repos, currentRepoId, repoName);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/vendor/diff2html/diff2html.min.css" />
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body data-repo-base="${escapeHtml(repoBase)}">
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="${repoBase}/tree/${querySuffix || ""}">${escapeHtml(repoName)}</a>
        ${repoSwitcher}
        <div class="meta">
          <span class="pill">${branch}</span>
          ${commit ? `<span class="pill mono">${commit}</span>` : ""}
        </div>
      </div>
    </header>
    <main class="container">
      ${body}
    </main>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>`;
}

interface ReviewThreadSummary {
  id: string;
  title: string;
  messageCount: number;
  unreadCount?: number;
  readUntil?: number | null;
  lastMessageId?: number | null;
  lastActivityAt?: string | null;
  createdAt: string;
}

interface ReviewListPageOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  threads: ReviewThreadSummary[];
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

export function renderReviewListPage({
  title,
  repoName,
  gitInfo,
  threads,
  repoBase,
  repos,
  currentRepoId,
}: ReviewListPageOptions): string {
  const branch = gitInfo?.branch ? escapeHtml(gitInfo.branch) : "no-git";
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";

  const threadRows = threads.length
    ? threads
        .map((t) => {
          const unread = t.readUntil
            ? t.lastMessageId && t.lastMessageId > t.readUntil
            : t.messageCount > 0;
          const badge = unread ? `<span class="review-unread-badge">${t.unreadCount || "new"}</span>` : "";
          const timeAgo = escapeHtml(formatReviewTime(t.lastActivityAt || t.createdAt));
          return `<a class="review-thread-row" href="${repoBase}/review/${encodeURIComponent(t.id)}">
  <div class="review-thread-info">
    <span class="review-thread-title">${escapeHtml(t.title)}${badge}</span>
    <span class="review-thread-meta">${t.messageCount} message${t.messageCount !== 1 ? "s" : ""} · ${timeAgo}</span>
  </div>
  <span class="review-thread-arrow">›</span>
</a>`;
        })
        .join("\n")
    : `<div class="review-empty">No review threads yet.</div>`;

  const body = `<section class="panel">
  <div class="panel-title">Review Threads</div>
  <div class="review-thread-list">
    ${threadRows}
  </div>
</section>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body data-repo-base="${escapeHtml(repoBase)}">
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="${repoBase}/tree/">${escapeHtml(repoName)}</a>
        ${renderRepoSwitcher(repos, currentRepoId, repoName)}
        <div class="meta">
          <span class="pill">${branch}</span>
          ${commit ? `<span class="pill mono">${commit}</span>` : ""}
        </div>
      </div>
    </header>
    <main class="container">
      ${body}
    </main>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>`;
}

interface ReviewComment {
  id: string;
  messageId: string;
  body: string;
  createdAt: string;
  resolved?: boolean;
  anchorLine?: number | null;
  anchorEndLine?: number | null;
}

function renderCommentCard(c: ReviewComment, msgId: string): string {
  return `<div class="review-comment-card${c.resolved ? " resolved" : ""}" data-comment-id="${escapeHtml(c.id)}" data-message-id="${escapeHtml(msgId)}" data-anchor-line="${c.anchorLine || ""}" data-anchor-end-line="${c.anchorEndLine || ""}">
  <div class="review-comment-header">
    <span class="review-comment-anchor">${c.anchorLine ? `Line ${c.anchorLine}${c.anchorEndLine && c.anchorEndLine !== c.anchorLine ? `-${c.anchorEndLine}` : ""}` : "General"}</span>
    <span class="review-comment-time" title="${escapeHtml(c.createdAt)}">${escapeHtml(formatReviewTime(c.createdAt))}</span>
    <span class="review-comment-actions">
      ${!c.resolved ? `<button class="btn btn-sm review-resolve-btn" data-comment-id="${escapeHtml(c.id)}">Resolve</button>` : `<span class="review-resolved-label">Resolved</span>`}
      <button class="btn btn-sm review-delete-comment-btn" data-comment-id="${escapeHtml(c.id)}">Delete</button>
    </span>
  </div>
  <div class="review-comment-body">${escapeHtml(c.body)}</div>
</div>`;
}

interface ReviewMessage {
  id: string;
  role: string;
  createdAt: string;
}

interface ReviewThread {
  id: string;
  title: string;
}

interface ReviewThreadPageOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  thread: ReviewThread;
  messages: ReviewMessage[];
  comments: ReviewComment[];
  renderedMessages: string[];
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

export function renderReviewThreadPage({
  title,
  repoName,
  gitInfo,
  thread,
  messages,
  comments,
  renderedMessages,
  repoBase,
  repos,
  currentRepoId,
}: ReviewThreadPageOptions): string {
  const branch = gitInfo?.branch ? escapeHtml(gitInfo.branch) : "no-git";
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";

  const messageBlocks = messages
    .map((msg, idx) => {
      const isAgent = msg.role === "agent";
      const roleClass = isAgent ? "review-msg-agent" : "review-msg-user";
      const roleLabel = isAgent ? "Agent" : "You";
      const rendered = renderedMessages[idx];

      // Gather comments for this message
      const msgComments = comments.filter((c) => c.messageId === msg.id);
      const commentHtml = msgComments.length
        ? `<div class="review-inline-comments">${msgComments.map((c) => renderCommentCard(c, msg.id)).join("\n")}</div>`
        : "";

      const contentWrapper = isAgent
        ? `<div class="markdown-body markdown-wrap review-msg-content" data-message-id="${escapeHtml(msg.id)}">${rendered}</div>`
        : `<div class="review-msg-content review-msg-text" data-message-id="${escapeHtml(msg.id)}">${escapeHtml(rendered)}</div>`;

      return `<div class="review-message ${roleClass}" data-message-id="${escapeHtml(msg.id)}">
  <div class="review-msg-header">
    <span class="review-msg-role">${roleLabel}</span>
    <span class="review-msg-time" title="${escapeHtml(msg.createdAt)}">${escapeHtml(formatReviewTime(msg.createdAt))}</span>
  </div>
  ${contentWrapper}
  ${commentHtml}
</div>`;
    })
    .join("\n");

  const body = `<section class="panel review-thread-panel">
  <div class="panel-title review-thread-header">
    <a class="btn" href="${repoBase}/review/">← Back</a>
    <span class="review-thread-title-text">${escapeHtml(thread.title)}</span>
    <span class="spacer"></span>
  </div>
  <div class="review-messages">
    ${messageBlocks || `<div class="review-empty">No messages yet.</div>`}
  </div>
  <div class="review-reply-form">
    <textarea id="review-reply-text" class="review-reply-textarea" placeholder="Write a reply..." rows="4"></textarea>
    <button id="review-reply-submit" class="btn review-reply-btn" data-thread-id="${escapeHtml(thread.id)}">Submit Reply</button>
  </div>
</section>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/vendor/github-markdown-css/github-markdown.css" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github.css" media="(prefers-color-scheme: light)" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github-dark.css" media="(prefers-color-scheme: dark)" />
    <link rel="stylesheet" href="/static/vendor/katex/katex.min.css" />
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body data-repo-base="${escapeHtml(repoBase)}">
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="${repoBase}/tree/">${escapeHtml(repoName)}</a>
        ${renderRepoSwitcher(repos, currentRepoId, repoName)}
        <div class="meta">
          <span class="pill">${branch}</span>
          ${commit ? `<span class="pill mono">${commit}</span>` : ""}
          <span id="conn-status" class="conn-status" title="Live reload: connecting..."></span>
        </div>
      </div>
    </header>
    <main class="container">
      ${body}
    </main>
    <script defer src="/static/vendor/katex/katex.min.js"></script>
    <script defer src="/static/vendor/katex/contrib/auto-render.min.js"></script>
    <script type="module" src="/static/app.js"></script>
    <script type="module" src="/static/review.js"></script>
  </body>
</html>`;
}

interface ErrorPageOptions {
  title: string;
  message: string;
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

export function renderErrorPage({ title, message, repoBase }: ErrorPageOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body data-repo-base="${escapeHtml(repoBase)}">
    <main class="container">
      <section class="panel">
        <div class="panel-title">Error</div>
        <div class="error">${escapeHtml(message)}</div>
      </section>
    </main>
  </body>
</html>`;
}

interface BrokenLinksPageOptions {
  title: string;
  repoName: string;
  gitInfo: GitInfo | null;
  relPathPosix: string | null | undefined;
  scanState: ScanState | null | undefined;
  querySuffix: string | null | undefined;
  toggleIgnoredHref: string | null | undefined;
  showIgnored: boolean;
  repoBase: string;
  repos: RepoSummary[];
  currentRepoId: string;
}

export function renderBrokenLinksPage({
  title,
  repoName,
  gitInfo,
  relPathPosix,
  scanState,
  querySuffix,
  toggleIgnoredHref,
  showIgnored,
  repoBase,
  repos,
  currentRepoId,
}: BrokenLinksPageOptions): string {
  const state: Partial<ScanState> = scanState || {};
  const result = state.lastResult;
  const broken = result?.broken || [];
  const statusLine =
    state.status === "running"
      ? "Scanning…"
      : result
        ? `Last scan: ${new Date(result.finishedAt).toLocaleString()} · Files: ${
            result.filesScanned
          } · URLs: ${result.urlsChecked} · Broken: ${broken.length} · ${result.durationMs}ms`
        : state.lastError
          ? `Last error: ${escapeHtml(state.lastError)}`
          : "No scan yet.";

  const grouped = new Map<string, typeof broken>();
  for (const b of broken) {
    const arr = grouped.get(b.source) || [];
    arr.push(b);
    grouped.set(b.source, arr);
  }

  const sections = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([source, items]) => {
      const sourceHref = `${repoBase}/blob/${source.split("/").map(encodeURIComponent).join("/")}${
        querySuffix || ""
      }`;
      const rows = items
        .map((i) => {
          const reason = escapeHtml(i.reason || "");
          const kind = escapeHtml(i.kind || "");
          const url = escapeHtml(i.url || "");
          const target = i.target ? escapeHtml(i.target) : "";
          return `<tr><td class="mono">${kind}</td><td class="mono">${reason}</td><td class="mono">${url}</td><td class="mono">${target}</td></tr>`;
        })
        .join("\n");
      return `<section class="panel">
  <div class="panel-title">
    <span class="filename"><a class="link" href="${sourceHref}">${escapeHtml(source)}</a></span>
    <span class="spacer"></span>
    <span class="pill">${items.length}</span>
  </div>
  <div class="table-wrap">
    <table class="file-table linkcheck">
      <thead><tr><th>Kind</th><th>Reason</th><th>URL</th><th>Target</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;
    })
    .join("\n");

  const body = `<section class="panel">
  <div class="panel-title">Broken links</div>
  <div class="note">${escapeHtml(statusLine)}</div>
</section>
${sections || `<section class="panel"><div class="panel-title">All good</div><div class="note">No broken internal links found.</div></section>`}`;

  return pageTemplateWithLinks({
    title,
    repoName,
    gitInfo,
    brokenLinks: scanState,
    toggleIgnoredHref,
    showIgnored,
    querySuffix,
    relPathPosix,
    bodyHtml: body,
    repoBase,
    repos,
    currentRepoId,
  });
}
