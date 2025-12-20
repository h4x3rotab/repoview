(() => {
  const shouldWatch = new URLSearchParams(location.search).get("watch") !== "0";
  if (!shouldWatch) return;

  const es = new EventSource("/events");
  es.addEventListener("reload", () => {
    location.reload();
  });
  es.addEventListener("error", () => {
    // Best-effort: EventSource auto-reconnects.
  });
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
    mermaid.initialize?.({ startOnLoad: false, securityLevel: "strict" });
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

window.addEventListener("load", () => {
  preserveQueryParamsOnInternalLinks(["ignored", "watch"]);
  renderMath();
  renderMermaid();
});
