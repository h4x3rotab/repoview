(() => {
  const shouldWatch = new URLSearchParams(location.search).get("watch") !== "0";
  const statusEl = document.getElementById("conn-status");

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
    const res = await fetch(`/rev?ts=${Date.now()}`, { cache: "no-store" });
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
    const es = new EventSource("/events");
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
