import path from "node:path";

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function encodePathForUrl(posixPath) {
  return posixPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function renderBreadcrumbs(relPathPosix, querySuffix) {
  const parts = (relPathPosix || "").split("/").filter(Boolean);
  const suffix = querySuffix || "";
  const crumbs = [{ name: "", href: `/tree/${suffix}` }];
  let cursor = "";
  for (const p of parts) {
    cursor = cursor ? `${cursor}/${p}` : p;
    crumbs.push({ name: p, href: `/tree/${encodePathForUrl(cursor)}${suffix}` });
  }

  const html = crumbs
    .map((c, idx) => {
      const label = idx === 0 ? "root" : escapeHtml(c.name);
      return `<a class="crumb" href="${c.href}">${label}</a>`;
    })
    .join(`<span class="crumb-sep">/</span>`);
  return `<nav class="breadcrumbs" aria-label="Breadcrumbs">${html}</nav>`;
}

function pageTemplate({ title, repoName, gitInfo, relPathPosix, bodyHtml }) {
  const branch = gitInfo?.branch ? escapeHtml(gitInfo.branch) : "no-git";
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/vendor/github-markdown-css/github-markdown-light.css" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github.css" />
    <link rel="stylesheet" href="/static/vendor/katex/katex.min.css" />
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="/tree/${querySuffix || ""}">${escapeHtml(repoName)}</a>
        <div class="meta">
          <span class="pill">${branch}</span>
          ${commit ? `<span class="pill mono">${commit}</span>` : ""}
        </div>
      </div>
      ${renderBreadcrumbs(relPathPosix, "")}
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

function renderBrokenLinksPill(brokenLinks, querySuffix) {
  const state = brokenLinks;
  if (!state) return "";
  const status = state.status;
  const count = state.lastResult?.broken?.length ?? 0;
  const href = `/broken-links${querySuffix || ""}`;
  if (status === "running") return `<a class="pill link" href="${href}">Scanning links…</a>`;
  if (state.lastResult) {
    return `<a class="pill link" href="${href}">Broken: ${count}</a>`;
  }
  if (state.lastError) return `<a class="pill link" href="${href}">Broken: ?</a>`;
  return "";
}

function renderIgnoredTogglePill({ toggleIgnoredHref, showIgnored }) {
  const href = toggleIgnoredHref || "#";
  const label = showIgnored ? "Ignored: on" : "Ignored: off";
  return `<a class="pill link" data-no-preserve="ignored" href="${href}">${label}</a>`;
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
}) {
  const branch = gitInfo?.branch ? escapeHtml(gitInfo.branch) : "no-git";
  const commit = gitInfo?.commit ? escapeHtml(gitInfo.commit.slice(0, 7)) : "";
  const brokenPill = renderBrokenLinksPill(brokenLinks, querySuffix);
  const ignoredPill = renderIgnoredTogglePill({ toggleIgnoredHref, showIgnored });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/vendor/github-markdown-css/github-markdown-light.css" />
    <link rel="stylesheet" href="/static/vendor/highlight.js/styles/github.css" />
    <link rel="stylesheet" href="/static/vendor/katex/katex.min.css" />
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-row">
        <a class="brand" href="/tree/">${escapeHtml(repoName)}</a>
        <div class="meta">
          <span class="pill">${branch}</span>
          ${commit ? `<span class="pill mono">${commit}</span>` : ""}
          ${brokenPill}
          ${ignoredPill}
        </div>
      </div>
      ${renderBreadcrumbs(relPathPosix, querySuffix)}
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
}) {
  const tableRows = rows
    .map((r) => {
      const icon = r.isDir ? "dir" : "file";
      const name = escapeHtml(r.name);
      return `<tr>
  <td class="name"><a class="item ${icon}" href="${r.href}">${name}</a></td>
  <td class="mtime">${escapeHtml(r.mtime)}</td>
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
        <tr><th class="name">Name</th><th class="mtime">Last modified</th><th class="size">Size</th></tr>
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
  });
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
  renderedHtml,
}) {
  const relDir = path.posix.dirname(relPathPosix || "");
  const suffix = querySuffix || "";
  const rawHref = `/raw/${encodePathForUrl(relPathPosix || "")}${suffix}`;
  const treeHref = `/tree/${encodePathForUrl(relDir === "." ? "" : relDir)}${suffix}`;

  const body = `<section class="panel">
  <div class="panel-title">
    <span class="filename">${escapeHtml(fileName)}</span>
    <span class="spacer"></span>
    <a class="btn" href="${treeHref}">Back</a>
    <a class="btn" href="${rawHref}">Raw</a>
  </div>
  <div class="${isMarkdown ? "markdown-body markdown-wrap" : "code-wrap"}">
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
  });
}

export function renderErrorPage({ title, message }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body>
    <main class="container">
      <section class="panel">
        <div class="panel-title">Error</div>
        <div class="error">${escapeHtml(message)}</div>
      </section>
    </main>
  </body>
</html>`;
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
}) {
  const state = scanState || {};
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

  const grouped = new Map();
  for (const b of broken) {
    const arr = grouped.get(b.source) || [];
    arr.push(b);
    grouped.set(b.source, arr);
  }

  const sections = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([source, items]) => {
      const sourceHref = `/blob/${source.split("/").map(encodeURIComponent).join("/")}${
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
  });
}
