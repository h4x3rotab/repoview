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

function renderBreadcrumbs(relPathPosix) {
  const parts = (relPathPosix || "").split("/").filter(Boolean);
  const crumbs = [{ name: "", href: "/tree/" }];
  let cursor = "";
  for (const p of parts) {
    cursor = cursor ? `${cursor}/${p}` : p;
    crumbs.push({ name: p, href: `/tree/${encodePathForUrl(cursor)}` });
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
    <link rel="stylesheet" href="/static/vendor/github-markdown-css/github-markdown.css" />
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
        </div>
      </div>
      ${renderBreadcrumbs(relPathPosix)}
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

export function renderTreePage({ title, repoName, gitInfo, relPathPosix, rows, readmeHtml }) {
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

  return pageTemplate({ title, repoName, gitInfo, relPathPosix, bodyHtml: body });
}

export function renderFilePage({
  title,
  repoName,
  gitInfo,
  relPathPosix,
  fileName,
  isMarkdown,
  renderedHtml,
}) {
  const relDir = path.posix.dirname(relPathPosix || "");
  const rawHref = `/raw/${encodePathForUrl(relPathPosix || "")}`;
  const treeHref = `/tree/${encodePathForUrl(relDir === "." ? "" : relDir)}`;

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

  return pageTemplate({ title, repoName, gitInfo, relPathPosix, bodyHtml: body });
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
