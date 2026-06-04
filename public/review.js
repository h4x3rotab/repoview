(() => {
  // Per-repo URL prefix (e.g. "/r/myrepo"); empty for legacy/root mounts.
  const repoBase = document.body.dataset.repoBase || "";

  // --- Reply form ---
  const replyBtn = document.getElementById("review-reply-submit");
  const replyText = document.getElementById("review-reply-text");

  if (replyBtn && replyText) {
    replyBtn.addEventListener("click", async () => {
      const body = replyText.value.trim();
      if (!body) return;

      const threadId = replyBtn.dataset.threadId;
      replyBtn.disabled = true;
      replyBtn.textContent = "Sending...";

      try {
        const res = await fetch(`${repoBase}/review/${encodeURIComponent(threadId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (res.ok) {
          replyText.value = "";
          location.reload();
        } else {
          const data = await res.json();
          alert(data.error || "Failed to send reply");
        }
      } catch (e) {
        alert("Network error: " + e.message);
      } finally {
        replyBtn.disabled = false;
        replyBtn.textContent = "Submit Reply";
      }
    });

    replyText.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        replyBtn.click();
      }
    });
  }

  // --- Shared: open inline comment form below a block ---
  function openCommentForm(block, messageId) {
    const existing = document.querySelector(".review-inline-form");
    if (existing) existing.remove();

    const lineStart = block.dataset.sourceLineStart;
    const lineEnd = block.dataset.sourceLineEnd;
    const anchorText = block.textContent.slice(0, 80);
    const lineLabel = lineEnd && lineEnd !== lineStart
      ? `lines ${lineStart}-${lineEnd}`
      : `line ${lineStart}`;

    const form = document.createElement("div");
    form.className = "review-inline-form";
    form.innerHTML = `
      <textarea class="review-inline-textarea" placeholder="Comment on ${lineLabel}..." rows="3"></textarea>
      <div class="review-inline-actions">
        <button class="btn btn-sm review-inline-submit" type="button">Comment</button>
        <button class="btn btn-sm review-inline-cancel" type="button">Cancel</button>
      </div>
    `;

    block.after(form);
    form.querySelector(".review-inline-textarea").focus();
    form.querySelector(".review-inline-cancel").addEventListener("click", () => form.remove());

    form.querySelector(".review-inline-submit").addEventListener("click", async () => {
      const body = form.querySelector(".review-inline-textarea").value.trim();
      if (!body) return;
      const threadId = document.querySelector("[data-thread-id]")?.dataset.threadId;
      if (!threadId) return;
      try {
        const res = await fetch(`${repoBase}/review/${encodeURIComponent(threadId)}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId, anchorLine: Number(lineStart),
            anchorEndLine: lineEnd ? Number(lineEnd) : null, anchorText, body,
          }),
        });
        if (res.ok) location.reload();
        else alert((await res.json()).error || "Failed to add comment");
      } catch (err) {
        alert("Network error: " + err.message);
      }
    });
  }

  // --- Build a map of which blocks have existing comments ---
  function buildCommentMap() {
    // Map: "messageId:anchorLine" → [comment card elements]
    const map = new Map();
    const cards = document.querySelectorAll(".review-comment-card[data-anchor-line]");
    for (const card of cards) {
      const line = card.dataset.anchorLine;
      const msgId = card.dataset.messageId;
      if (!line || !msgId) continue;
      const key = `${msgId}:${line}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(card);
    }
    return map;
  }

  function findCommentsForBlock(commentMap, messageId, block) {
    const start = Number(block.dataset.sourceLineStart);
    const end = Number(block.dataset.sourceLineEnd) || start;
    const found = [];
    for (const [key, cards] of commentMap) {
      const [mid, lineStr] = key.split(":");
      if (mid !== messageId) continue;
      const line = Number(lineStr);
      if (line >= start && line <= end) found.push(...cards);
    }
    return found;
  }

  // Show existing comments + add-reply form anchored below a block
  function openCommentThread(block, messageId, existingCards) {
    const existing = document.querySelector(".review-inline-form");
    if (existing) existing.remove();

    const lineStart = block.dataset.sourceLineStart;
    const lineEnd = block.dataset.sourceLineEnd;
    const anchorText = block.textContent.slice(0, 80);
    const lineLabel = lineEnd && lineEnd !== lineStart
      ? `lines ${lineStart}-${lineEnd}`
      : `line ${lineStart}`;

    const form = document.createElement("div");
    form.className = "review-inline-form";

    // Clone existing comment cards into the thread view
    const commentsHtml = existingCards.map((card) => card.outerHTML).join("");

    form.innerHTML = `
      <div class="review-inline-thread">${commentsHtml}</div>
      <textarea class="review-inline-textarea" placeholder="Reply on ${lineLabel}..." rows="2"></textarea>
      <div class="review-inline-actions">
        <button class="btn btn-sm review-inline-submit" type="button">Comment</button>
        <button class="btn btn-sm review-inline-cancel" type="button">Cancel</button>
      </div>
    `;

    block.after(form);
    form.querySelector(".review-inline-textarea").focus();
    form.querySelector(".review-inline-cancel").addEventListener("click", () => form.remove());

    form.querySelector(".review-inline-submit").addEventListener("click", async () => {
      const body = form.querySelector(".review-inline-textarea").value.trim();
      if (!body) return;
      const threadId = document.querySelector("[data-thread-id]")?.dataset.threadId;
      if (!threadId) return;
      try {
        const res = await fetch(`${repoBase}/review/${encodeURIComponent(threadId)}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId, anchorLine: Number(lineStart),
            anchorEndLine: lineEnd ? Number(lineEnd) : null, anchorText, body,
          }),
        });
        if (res.ok) location.reload();
        else alert((await res.json()).error || "Failed to add comment");
      } catch (err) {
        alert("Network error: " + err.message);
      }
    });
  }

  // --- Inline comments: gutter buttons (desktop) + tap-to-comment (mobile) ---
  function initInlineComments() {
    const isMobile = window.matchMedia("(max-width: 560px)").matches;
    const commentMap = buildCommentMap();
    const agentMessages = document.querySelectorAll(".review-msg-agent .review-msg-content");

    for (const msgEl of agentMessages) {
      const messageId = msgEl.dataset.messageId;
      if (!messageId) continue;

      const blocks = msgEl.querySelectorAll("[data-source-line-start]");
      for (const block of blocks) {
        block.style.position = "relative";
        const blockComments = findCommentsForBlock(commentMap, messageId, block);
        const hasComments = blockComments.length > 0;

        // Add comment count badge on the right if block has comments
        if (hasComments) {
          const badge = document.createElement("span");
          badge.className = "review-comment-badge";
          badge.textContent = blockComments.length;
          badge.title = `${blockComments.length} comment${blockComments.length > 1 ? "s" : ""}`;
          block.appendChild(badge);
        }

        const handleClick = (e) => {
          if (e.target.closest("a, button, .review-inline-form, .code-ref")) return;
          e.stopPropagation();
          if (hasComments) {
            openCommentThread(block, messageId, blockComments);
          } else {
            openCommentForm(block, messageId);
          }
        };

        if (isMobile) {
          block.addEventListener("click", handleClick);
        } else {
          // Desktop: gutter "+" button (or comment count acts as button too)
          if (!hasComments) {
            const btn = document.createElement("button");
            btn.className = "review-gutter-btn";
            btn.type = "button";
            btn.textContent = "+";
            btn.title = "Add inline comment";
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              openCommentForm(block, messageId);
            });
            block.appendChild(btn);
          } else {
            // The badge is clickable on desktop too
            block.querySelector(".review-comment-badge").addEventListener("click", (e) => {
              e.stopPropagation();
              openCommentThread(block, messageId, blockComments);
            });
            // Also show gutter "+" for adding new comment on this block
            const btn = document.createElement("button");
            btn.className = "review-gutter-btn";
            btn.type = "button";
            btn.textContent = "+";
            btn.title = "Add inline comment";
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              openCommentForm(block, messageId);
            });
            block.appendChild(btn);
          }
        }
      }
    }
  }

  // --- Resolve / Delete comment buttons ---
  function initCommentActions() {
    const threadId = document.querySelector("[data-thread-id]")?.dataset.threadId;
    if (!threadId) return;

    document.addEventListener("click", async (e) => {
      const resolveBtn = e.target.closest(".review-resolve-btn");
      if (resolveBtn) {
        const commentId = resolveBtn.dataset.commentId;
        try {
          const res = await fetch(`${repoBase}/review/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolved: true }),
          });
          if (res.ok) location.reload();
        } catch { /* ignore */ }
        return;
      }

      const deleteBtn = e.target.closest(".review-delete-comment-btn");
      if (deleteBtn) {
        const commentId = deleteBtn.dataset.commentId;
        if (!confirm("Delete this comment?")) return;
        try {
          const res = await fetch(`${repoBase}/review/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}`, {
            method: "DELETE",
          });
          if (res.ok) location.reload();
        } catch { /* ignore */ }
      }
    });
  }

  // ─── Code reference detection & popup ───────────────────────────────

  // Match: path/to/file.ext:line or path/to/file.ext:line-endline
  // Must contain a "/" or start with known src-like prefix, and have a real extension
  const CODE_REF_RE = /(?:^|[\s(>`])(([\w./-]+\/[\w./-]+\.[\w]+|[\w.-]+\.(?:js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|cs|swift|kt|vue|svelte|sh|sql|proto))(?::(\d+)(?:-(\d+))?)?)(?=[\s)<,.:;`]|$)/g;

  const KNOWN_EXTENSIONS = new Set([
    "js","ts","tsx","jsx","mjs","cjs","py","rb","go","rs","java","c","cpp","h","hpp",
    "cs","swift","kt","vue","svelte","sh","bash","sql","graphql","proto","yaml","yml",
    "toml","json","css","scss","less","html","xml","md","txt","conf","cfg","ini","lock",
  ]);

  function looksLikeFilePath(str) {
    const ext = str.split(".").pop()?.toLowerCase();
    return ext && KNOWN_EXTENSIONS.has(ext);
  }

  // Matches a full file reference: path/file.ext or path/file.ext:line or path/file.ext:line-end
  const INLINE_CODE_REF_RE = /^([\w./-]+\/[\w./-]+\.[\w]+|[\w.-]+\.(?:js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|cs|swift|kt|vue|svelte|sh|sql|proto))(?::(\d+)(?:-(\d+))?)?$/;

  function makeCodeRefLink(file, line, endLine, displayText) {
    const link = document.createElement("a");
    link.className = "code-ref";
    link.href = `/blob/${encodeURI(file)}${line ? "#L" + line : ""}`;
    link.dataset.file = file;
    link.dataset.line = line || "1";
    if (endLine) link.dataset.endLine = String(endLine);
    link.textContent = displayText;
    link.title = `View ${displayText}`;
    return link;
  }

  function initCodeRefs() {
    const containers = document.querySelectorAll(".review-msg-content");
    for (const container of containers) {
      linkifyInlineCode(container);
      linkifyTextNodes(container);
    }

    // Delegate clicks on .code-ref links
    document.addEventListener("click", (e) => {
      const ref = e.target.closest(".code-ref");
      if (!ref) return;
      e.preventDefault();
      e.stopPropagation();
      showCodePopup(ref.dataset.file, Number(ref.dataset.line) || 1, Number(ref.dataset.endLine) || 0);
    });
  }

  // Turn inline <code>src/foo.ts:45</code> into clickable links
  function linkifyInlineCode(container) {
    // Only match <code> elements that are NOT inside <pre> (i.e. inline code, not code blocks)
    const codeElements = [...container.querySelectorAll("code")].filter(
      (el) => !el.closest("pre") && !el.closest("a"),
    );

    for (const code of codeElements) {
      const text = code.textContent.trim();
      const m = text.match(INLINE_CODE_REF_RE);
      if (!m) continue;
      const filePath = m[1];
      if (!looksLikeFilePath(filePath)) continue;

      const line = m[2] ? parseInt(m[2], 10) : null;
      const endLine = m[3] ? parseInt(m[3], 10) : null;
      const link = makeCodeRefLink(filePath, line, endLine, text);
      code.replaceWith(link);
    }
  }

  // Also linkify bare text references (not inside code/pre/a tags)
  function linkifyTextNodes(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "CODE" || tag === "PRE" || tag === "A" || tag === "TEXTAREA" || tag === "INPUT") {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      CODE_REF_RE.lastIndex = 0;

      const matches = [];
      let m;
      while ((m = CODE_REF_RE.exec(text)) !== null) {
        const fullMatch = m[1];
        const filePath = m[2];
        if (!looksLikeFilePath(filePath)) continue;
        const offset = m.index + m[0].indexOf(fullMatch);
        matches.push({
          start: offset,
          end: offset + fullMatch.length,
          file: filePath,
          line: m[3] ? parseInt(m[3], 10) : null,
          endLine: m[4] ? parseInt(m[4], 10) : null,
          text: fullMatch,
        });
      }

      if (!matches.length) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const match of matches) {
        if (match.start > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, match.start)));
        }
        frag.appendChild(makeCodeRefLink(match.file, match.line, match.endLine, match.text));
        cursor = match.end;
      }
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  // ─── Code popup ─────────────────────────────────────────────────────

  let activePopup = null;

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function showCodePopup(file, line, endLine) {
    if (activePopup) { activePopup.remove(); activePopup = null; }

    const end = endLine || line;
    const overlay = document.createElement("div");
    overlay.className = "code-popup-overlay";
    overlay.innerHTML = `
      <div class="code-popup">
        <div class="code-popup-header">
          <a class="code-popup-filepath" href="/blob/${encodeURI(file)}${line ? "#L" + line : ""}" title="Open in file viewer">${escapeHtml(file)}${line ? ":" + line + (endLine && endLine !== line ? "-" + endLine : "") : ""}</a>
          <span class="spacer"></span>
          <button class="btn btn-sm code-popup-tab active" data-mode="source">Source</button>
          <button class="btn btn-sm code-popup-tab" data-mode="diff">Diff</button>
          <button class="code-popup-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="code-popup-body">
          <div class="code-popup-loading">Loading...</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    activePopup = overlay;

    // Close handlers
    overlay.querySelector(".code-popup-close").addEventListener("click", closePopup);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePopup();
    });

    // Fetch code context
    // Show more context when no specific line, less when targeting a line
    const ctx = line <= 1 && !endLine ? "100" : "20";
    const params = new URLSearchParams({ file, line: String(line), context: ctx });
    if (endLine) params.set("endLine", String(endLine));

    let data;
    try {
      const res = await fetch(`${repoBase}/api/code-context?${params}`);
      if (!res.ok) {
        const err = await res.json();
        showPopupError(overlay, err.error || "Failed to load file");
        return;
      }
      data = await res.json();
    } catch (e) {
      showPopupError(overlay, "Network error: " + e.message);
      return;
    }

    // Render source view
    renderSourceView(overlay, data);

    // Tab switching
    const tabs = overlay.querySelectorAll(".code-popup-tab");
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        for (const t of tabs) t.classList.remove("active");
        tab.classList.add("active");
        if (tab.dataset.mode === "diff") {
          renderDiffView(overlay, data);
        } else {
          renderSourceView(overlay, data);
        }
      });
    }
  }

  function renderSourceView(overlay, data) {
    const body = overlay.querySelector(".code-popup-body");
    const lines = data.lines.map((lineText, i) => {
      const lineNum = data.startLine + i;
      const isHighlight = lineNum >= data.highlightStart && lineNum <= data.highlightEnd;
      const cls = isHighlight ? " highlight" : "";
      return `<tr class="code-line${cls}" id="L${lineNum}"><td class="code-ln">${lineNum}</td><td class="code-content">${escapeHtml(lineText)}</td></tr>`;
    }).join("");

    body.innerHTML = `<table class="code-table"><tbody>${lines}</tbody></table>`;

    // Scroll highlighted line into view
    const target = body.querySelector(".code-line.highlight");
    if (target) {
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
    }

    // Try to apply highlight.js if available
    tryHighlight(body, data.language);
  }

  function renderDiffView(overlay, data) {
    const body = overlay.querySelector(".code-popup-body");
    if (!data.diff) {
      body.innerHTML = `<div class="code-popup-empty">No uncommitted changes in this file.</div>`;
      return;
    }

    // Parse unified diff into lines with +/- markers
    const diffLines = data.diff.split("\n");
    const rows = [];
    let inHunk = false;
    let oldLn = 0, newLn = 0;

    for (const raw of diffLines) {
      if (raw.startsWith("@@")) {
        inHunk = true;
        const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
        if (m) { oldLn = parseInt(m[1], 10); newLn = parseInt(m[2], 10); }
        rows.push(`<tr class="diff-hunk"><td colspan="3">${escapeHtml(raw)}</td></tr>`);
        continue;
      }
      if (!inHunk) continue;

      if (raw.startsWith("+")) {
        const inRange = newLn >= data.highlightStart && newLn <= data.highlightEnd;
        rows.push(`<tr class="diff-add${inRange ? " highlight" : ""}"><td class="code-ln">${newLn}</td><td class="diff-marker">+</td><td class="code-content">${escapeHtml(raw.slice(1))}</td></tr>`);
        newLn++;
      } else if (raw.startsWith("-")) {
        rows.push(`<tr class="diff-del"><td class="code-ln">${oldLn}</td><td class="diff-marker">-</td><td class="code-content">${escapeHtml(raw.slice(1))}</td></tr>`);
        oldLn++;
      } else if (raw.startsWith(" ")) {
        const inRange = newLn >= data.highlightStart && newLn <= data.highlightEnd;
        rows.push(`<tr class="diff-ctx${inRange ? " highlight" : ""}"><td class="code-ln">${newLn}</td><td class="diff-marker"> </td><td class="code-content">${escapeHtml(raw.slice(1))}</td></tr>`);
        oldLn++; newLn++;
      }
    }

    body.innerHTML = `<table class="code-table">${rows.join("")}</table>`;

    const target = body.querySelector(".highlight");
    if (target) {
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
    }
  }

  function tryHighlight(body, lang) {
    // Use highlight.js if loaded on the page
    if (!window.hljs) return;
    const cells = body.querySelectorAll(".code-content");
    for (const cell of cells) {
      const text = cell.textContent;
      try {
        const result = lang && window.hljs.getLanguage(lang)
          ? window.hljs.highlight(text, { language: lang })
          : window.hljs.highlightAuto(text);
        cell.innerHTML = result.value;
      } catch { /* ignore */ }
    }
  }

  function showPopupError(overlay, message) {
    overlay.querySelector(".code-popup-body").innerHTML =
      `<div class="code-popup-empty">${escapeHtml(message)}</div>`;
  }

  function closePopup() {
    if (activePopup) { activePopup.remove(); activePopup = null; }
  }

  // Close popup on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopup();
  });

  // --- Initialize ---
  window.addEventListener("load", () => {
    initInlineComments();
    initCommentActions();
    initCodeRefs();
  });
})();
