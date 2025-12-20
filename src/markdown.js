import path from "node:path";
import hljs from "highlight.js";
import GithubSlugger from "github-slugger";
import MarkdownIt from "markdown-it";
import { full as emoji } from "markdown-it-emoji";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import sanitizeHtml from "sanitize-html";

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isExternalHref(href) {
  return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:");
}

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

function normalizeRepoPath(posixPath) {
  const stripped = String(posixPath || "").replace(/^\/+/, "");
  let normalized = path.posix.normalize(stripped);
  if (normalized === "." || normalized === "./") return "";
  // GitHub effectively clamps links so they can't escape the repo root.
  while (normalized === ".." || normalized.startsWith("../")) {
    normalized = normalized === ".." ? "" : normalized.slice(3);
  }
  return normalized;
}

function encodePathForUrl(posixPath) {
  return posixPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function rewriteLinkHref(href, baseDirPosix) {
  if (!href) return href;
  if (href.startsWith("#") || isExternalHref(href)) return href;

  const trimmed = href.trim();
  const hashIndex = trimmed.indexOf("#");
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";

  const queryIndex = beforeHash.indexOf("?");
  const rawPath = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex) : "";

  if (/^\/(?:blob|tree|raw|static)(?:\/|$)/.test(rawPath) || rawPath === "/events") {
    return href;
  }

  const raw = rawPath.trim();
  if (!raw) return href;

  const isRooted = raw.startsWith("/");
  const targetPosix = isRooted
    ? normalizeRepoPath(raw)
    : normalizeRepoPath(path.posix.join(baseDirPosix || "", raw));
  if (targetPosix == null) return href;

  const isTree = raw.endsWith("/") || targetPosix === "";
  const newPath = `/${isTree ? "tree" : "blob"}/${encodePathForUrl(targetPosix)}`;
  const withQuery = query ? `${newPath}${query}` : newPath;
  return hash ? `${withQuery}#${hash}` : withQuery;
}

function rewriteImageSrc(src, baseDirPosix) {
  if (!src) return src;
  if (isExternalHref(src) || src.startsWith("data:")) return src;

  const trimmed = src.trim();
  const hashIndex = trimmed.indexOf("#");
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";

  const queryIndex = beforeHash.indexOf("?");
  const rawPath = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex) : "";

  if (/^\/(?:raw|static)(?:\/|$)/.test(rawPath)) return src;

  const isRooted = rawPath.startsWith("/");
  const targetPosix = isRooted
    ? normalizeRepoPath(rawPath)
    : normalizeRepoPath(path.posix.join(baseDirPosix || "", rawPath));
  if (targetPosix == null) return src;
  const newPath = `/raw/${encodePathForUrl(targetPosix)}`;
  const withQuery = query ? `${newPath}${query}` : newPath;
  return hash ? `${withQuery}#${hash}` : withQuery;
}

export function createMarkdownRenderer() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  })
    .use(emoji, { shortcuts: {} })
    .use(footnote)
    .use(taskLists, { enabled: true, label: false, labelAfter: false })
    .enable(["table", "strikethrough"]);

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const info = (token.info || "").trim();
    const lang = info.split(/\s+/g)[0]?.toLowerCase() || "";
    if (lang === "mermaid") {
      return `<pre class="mermaid">${escapeHtml(token.content || "")}</pre>\n`;
    }
    if (typeof defaultFence === "function") return defaultFence(tokens, idx, options, env, self);
    return self.renderToken(tokens, idx, options);
  };

  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const hrefIndex = token.attrIndex("href");
    if (hrefIndex >= 0) {
      const href = token.attrs[hrefIndex][1];
      const rewritten = rewriteLinkHref(href, env.baseDirPosix || "");
      token.attrs[hrefIndex][1] = rewritten;
      if (isExternalHref(href)) {
        token.attrSet("target", "_blank");
        token.attrSet("rel", "noreferrer noopener");
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  const defaultImage =
    md.renderer.rules.image ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
  md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const srcIndex = token.attrIndex("src");
    if (srcIndex >= 0) {
      const src = token.attrs[srcIndex][1];
      token.attrs[srcIndex][1] = rewriteImageSrc(src, env.baseDirPosix || "");
    }
    return defaultImage(tokens, idx, options, env, self);
  };

  const defaultHeadingOpen =
    md.renderer.rules.heading_open ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
  md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    if (token.attrIndex("id") < 0 && token.tag && token.tag.startsWith("h")) {
      const titleToken = tokens[idx + 1];
      const headingText = titleToken?.content || "";
      const slugger = env.__slugger || (env.__slugger = new GithubSlugger());
      const slug = slugger.slug(headingText);
      if (slug) token.attrSet("id", slug);
    }
    const idIndex = token.attrIndex("id");
    const id = idIndex >= 0 ? token.attrs[idIndex][1] : "";
    const rendered = defaultHeadingOpen(tokens, idx, options, env, self);
    if (!id) return rendered;
    return `${rendered}<a class="anchor" aria-hidden="true" href="#${escapeHtml(id)}"></a>`;
  };

  const alertTypes = new Map([
    ["NOTE", { classSuffix: "note", title: "Note" }],
    ["TIP", { classSuffix: "tip", title: "Tip" }],
    ["IMPORTANT", { classSuffix: "important", title: "Important" }],
    ["WARNING", { classSuffix: "warning", title: "Warning" }],
    ["CAUTION", { classSuffix: "caution", title: "Caution" }],
  ]);

  md.core.ruler.after("inline", "github-alerts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") continue;

      let level = 1;
      let closeIndex = -1;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === "blockquote_open") level++;
        else if (tokens[j].type === "blockquote_close") level--;
        if (level === 0) {
          closeIndex = j;
          break;
        }
      }
      if (closeIndex === -1) continue;

      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      if (paragraphOpen?.type !== "paragraph_open" || inline?.type !== "inline") continue;
      const children = inline.children || [];

      const firstTextIndex = children.findIndex(
        (t) => t.type === "text" && /^\s*\[!\w+\]/.test(t.content),
      );
      if (firstTextIndex === -1) continue;

      const match = children[firstTextIndex].content.match(
        /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i,
      );
      if (!match) continue;
      const typeKey = match[1].toUpperCase();
      const alert = alertTypes.get(typeKey);
      if (!alert) continue;

      children[firstTextIndex].content = children[firstTextIndex].content.slice(match[0].length);
      if (children[firstTextIndex].content.length === 0) {
        children.splice(firstTextIndex, 1);
        if (children[firstTextIndex]?.type === "softbreak") children.splice(firstTextIndex, 1);
      }
      while (children[0]?.type === "softbreak") children.shift();

      const open = tokens[i];
      open.type = "html_block";
      open.tag = "";
      open.nesting = 0;
      open.markup = "";
      open.content = `<div class="markdown-alert markdown-alert-${alert.classSuffix}">\n`;
      open.block = true;

      const close = tokens[closeIndex];
      close.type = "html_block";
      close.tag = "";
      close.nesting = 0;
      close.markup = "";
      close.content = `</div>\n`;
      close.block = true;

      const titleToken = new state.Token("html_block", "", 0);
      titleToken.content = `<p class="markdown-alert-title">${escapeHtml(alert.title)}</p>\n`;
      titleToken.block = true;
      tokens.splice(i + 1, 0, titleToken);
      i++;
    }
  });

  function sanitize(html, env) {
    const baseDirPosix = env?.baseDirPosix || "";
    return sanitizeHtml(html, {
      allowedTags: [
        ...sanitizeHtml.defaults.allowedTags,
        "details",
        "summary",
        "img",
        "section",
        "sup",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "pre",
        "code",
        "span",
        "div",
        "kbd",
        "input",
      ],
      allowedAttributes: {
        "*": ["class", "id", "aria-label", "aria-hidden", "role"],
        a: ["href", "name", "title", "target", "rel", "tabindex"],
        img: ["src", "alt", "title", "width", "height", "loading"],
        input: ["type", "checked", "disabled"],
        details: ["open"],
      },
      allowedSchemes: ["http", "https", "mailto", "tel", "data"],
      allowProtocolRelative: true,
      transformTags: {
        a: (tagName, attribs) => {
          const next = { ...attribs };
          if (next.href) {
            const originalHref = next.href;
            next.href = rewriteLinkHref(originalHref, baseDirPosix);
            if (isExternalHref(originalHref)) {
              next.target = "_blank";
              next.rel = "noreferrer noopener";
            }
          }
          return { tagName, attribs: next };
        },
        img: (tagName, attribs) => {
          const next = { ...attribs };
          if (next.src) next.src = rewriteImageSrc(next.src, baseDirPosix);
          if (!next.loading) next.loading = "lazy";
          return { tagName, attribs: next };
        },
        input: (tagName, attribs) => {
          const next = { ...attribs };
          if (next.type === "checkbox") next.disabled = "disabled";
          return { tagName, attribs: next };
        },
      },
    });
  }

  return {
    render(markdown, env) {
      const e = env ?? {};
      const html = md.render(markdown ?? "", e);
      return sanitize(html, e);
    },
    renderCodeBlock(text, { languageHint } = {}) {
      const lang = languageHint && hljs.getLanguage(languageHint) ? languageHint : "";
      const highlighted = lang
        ? hljs.highlight(text, { language: lang }).value
        : hljs.highlightAuto(text).value;
      return sanitize(
        `<pre class="hljs"><code>${highlighted || escapeHtml(text)}</code></pre>`,
        { baseDirPosix: "" },
      );
    },
  };
}
