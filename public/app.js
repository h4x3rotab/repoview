(() => {
  const shouldWatch = new URLSearchParams(location.search).get("watch") !== "0";
  const statusEl = document.getElementById("conn-status");
  // Per-repo URL prefix (e.g. "/r/myrepo"); empty for legacy/root mounts.
  const repoBase = document.body.dataset.repoBase || "";

  function setStatus(state) {
    if (!statusEl) return;
    statusEl.dataset.status = state;
    const titles = {
      connected: "Live reload: connected",
      connecting: "Live reload: connecting...",
      polling: "Live reload: polling",
      disconnected: "Live reload: disconnected",
    };
    statusEl.title = titles[state] || "";
  }

  if (!shouldWatch) {
    if (statusEl) statusEl.style.display = "none";
    return;
  }

  let pollingTimer = null;
  let lastRevision = null;

  async function fetchRevision() {
    const res = await fetch(`${repoBase}/rev?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("rev fetch failed");
    const json = await res.json();
    return Number(json.revision);
  }

  async function ensurePolling() {
    if (pollingTimer) return;
    setStatus("polling");
    try {
      lastRevision = await fetchRevision();
    } catch {
      lastRevision = null;
    }
    pollingTimer = setInterval(async () => {
      try {
        const rev = await fetchRevision();
        if (lastRevision != null && rev !== lastRevision) location.reload();
        lastRevision = rev;
      } catch {
        // ignore
      }
    }, 2000);
  }

  try {
    const es = new EventSource(`${repoBase}/events`);
    es.addEventListener("open", () => {
      setStatus("connected");
    });
    es.addEventListener("reload", () => {
      location.reload();
    });
    es.addEventListener("error", () => {
      setStatus("disconnected");
      // Some environments/proxies break SSE; fall back to polling.
      void ensurePolling();
    });
  } catch {
    void ensurePolling();
  }
})();

function preserveQueryParamsOnInternalLinks(keys) {
  const current = new URLSearchParams(location.search);
  const keep = new URLSearchParams();
  for (const k of keys) {
    const v = current.get(k);
    if (v != null) keep.set(k, v);
  }
  if ([...keep.keys()].length === 0) return;

  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    if (!href.startsWith("/")) continue;
    if (href.startsWith("/static/")) continue;
    if (href.startsWith("/events")) continue;

    const noPreserve = String(a.getAttribute("data-no-preserve") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const u = new URL(href, location.origin);
      for (const [k, v] of keep.entries()) {
        if (noPreserve.includes(k)) continue;
        if (!u.searchParams.has(k)) u.searchParams.set(k, v);
      }
      a.setAttribute("href", u.pathname + u.search + u.hash);
    } catch {
      // ignore
    }
  }
}

async function renderMermaid() {
  const nodes = document.querySelectorAll(".mermaid");
  if (!nodes.length) return;
  try {
    const mod = await import("/static/vendor/mermaid/mermaid.esm.min.mjs");
    const mermaid = mod.default ?? mod.mermaid ?? mod;
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    mermaid.initialize?.({
      startOnLoad: false,
      securityLevel: "strict",
      theme: isDark ? "dark" : "default",
    });
    if (typeof mermaid.run === "function") {
      await mermaid.run({ nodes });
    }
  } catch {
    // Ignore; Mermaid is best-effort.
  }
}

function renderMath() {
  const root = document.querySelector(".markdown-body");
  if (!root) return;
  const renderMathInElement = window.renderMathInElement;
  if (typeof renderMathInElement !== "function") return;
  try {
    renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  } catch {
    // Ignore; KaTeX is best-effort.
  }
}

function formatDateTime(ms, useUtc) {
  const d = new Date(ms);
  const opts = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: useUtc ? "UTC" : undefined,
  };
  const formatted = d.toLocaleString(undefined, opts);
  return useUtc ? `${formatted} UTC` : formatted;
}

function initTimezoneToggle() {
  const toggle = document.querySelector(".tz-toggle");
  if (!toggle) return;

  const cells = document.querySelectorAll(".mtime[data-ts]");
  if (!cells.length) return;

  let useUtc = localStorage.getItem("tz") === "utc";

  function update() {
    toggle.textContent = useUtc ? "UTC" : "Local";
    for (const cell of cells) {
      const ts = Number(cell.dataset.ts);
      if (ts) cell.textContent = formatDateTime(ts, useUtc);
    }
  }

  toggle.addEventListener("click", () => {
    useUtc = !useUtc;
    localStorage.setItem("tz", useUtc ? "utc" : "local");
    update();
  });

  update();
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function initDiffCollapse() {
  const wrappers = document.querySelectorAll(".d2h-file-wrapper");
  if (!wrappers.length) return;

  // Diffs are hidden by CSS by default (.d2h-file-diff:not(.expanded)).
  // Only expand when there are few files — avoids layout/paint cost for large diffs.
  const shouldExpand = wrappers.length <= 8;

  // Add expand/collapse all buttons
  const diffWrap = document.querySelector(".diff-wrap");
  if (diffWrap && wrappers.length > 1) {
    const bar = document.createElement("div");
    bar.className = "diff-actions";
    bar.innerHTML = `<button type="button" class="btn btn-sm" id="expand-all">Expand all</button>
      <button type="button" class="btn btn-sm" id="collapse-all">Collapse all</button>`;
    diffWrap.insertBefore(bar, diffWrap.firstChild);
  }

  for (const wrapper of wrappers) {
    const header = wrapper.querySelector(".d2h-file-header");
    const diff = wrapper.querySelector(".d2h-file-diff");
    if (!header || !diff) continue;

    const fileNameEl = header.querySelector(".d2h-file-name");
    if (fileNameEl && !fileNameEl.querySelector("a")) {
      const rawName = fileNameEl.textContent.trim();
      const name = rawName.includes(" → ") ? rawName.split(" → ").pop() : rawName;
      const link = document.createElement("a");
      link.className = "diff-file-link";
      link.href = `/blob/${encodeURI(name)}`;
      link.textContent = rawName;
      fileNameEl.textContent = "";
      fileNameEl.appendChild(link);

      const copyBtn = document.createElement("button");
      copyBtn.className = "diff-copy-btn";
      copyBtn.type = "button";
      copyBtn.setAttribute("aria-label", "Copy filename");
      copyBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="5" y="5" width="9" height="9" rx="1.5"/>' +
        '<path d="M3 11V2.5A1.5 1.5 0 0 1 4.5 1H11"/>' +
        "</svg>";
      const svgIcon = copyBtn.innerHTML;
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const showSuccess = () => {
          copyBtn.textContent = "\u2713";
          setTimeout(() => { copyBtn.innerHTML = svgIcon; }, 1500);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(name).then(showSuccess).catch(() => {
            fallbackCopy(name);
            showSuccess();
          });
        } else {
          fallbackCopy(name);
          showSuccess();
        }
      });
      fileNameEl.appendChild(copyBtn);
    }

    const toggle = document.createElement("button");
    toggle.className = "diff-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Toggle file diff");

    if (shouldExpand) {
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "\u25BE";
      diff.classList.add("expanded");
    } else {
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "\u25B8";
    }
    header.appendChild(toggle);

    header.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.textContent = expanded ? "\u25B8" : "\u25BE";
      diff.classList.toggle("expanded");
    });
  }

  document.getElementById("expand-all")?.addEventListener("click", () => {
    for (const wrapper of wrappers) {
      const toggle = wrapper.querySelector(".diff-toggle");
      const diff = wrapper.querySelector(".d2h-file-diff");
      if (!toggle || !diff) continue;
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "\u25BE";
      diff.classList.add("expanded");
    }
  });

  document.getElementById("collapse-all")?.addEventListener("click", () => {
    for (const wrapper of wrappers) {
      const toggle = wrapper.querySelector(".diff-toggle");
      const diff = wrapper.querySelector(".d2h-file-diff");
      if (!toggle || !diff) continue;
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "\u25B8";
      diff.classList.remove("expanded");
    }
  });
}

function initBaseSelector() {
  const sel = document.getElementById("base-selector");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const u = new URL(location.href);
    if (sel.value === "HEAD") {
      u.searchParams.delete("base");
    } else {
      u.searchParams.set("base", sel.value);
    }
    location.href = u.pathname + u.search;
  });
}

function initLineHighlight() {
  const hash = location.hash;
  const m = hash.match(/^#L(\d+)$/);
  if (!m) return;
  const lineNum = parseInt(m[1], 10);

  const codeBlock = document.querySelector(".code-wrap pre code, .code-wrap pre");
  if (!codeBlock) return;

  const text = codeBlock.textContent;
  const lines = text.split("\n");
  if (lineNum < 1 || lineNum > lines.length) return;

  // Wrap lines in spans so we can highlight and scroll to the target
  const html = codeBlock.innerHTML;
  const htmlLines = html.split("\n");
  codeBlock.innerHTML = htmlLines
    .map((l, i) => {
      const num = i + 1;
      const cls = num === lineNum ? "line-highlight" : "";
      return `<span class="code-line-wrap ${cls}" id="L${num}">${l}</span>`;
    })
    .join("\n");

  const target = document.getElementById(`L${lineNum}`);
  if (target) {
    requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
  }
}

window.addEventListener("load", () => {
  preserveQueryParamsOnInternalLinks(["ignored", "watch", "base", "show_all"]);
  renderMath();
  renderMermaid();
  initTimezoneToggle();
  initBaseSelector();
  initDiffCollapse();
  initLineHighlight();
});
