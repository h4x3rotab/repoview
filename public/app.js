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
  renderMath();
  renderMermaid();
});
