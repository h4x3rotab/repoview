(() => {
  const errEl = document.getElementById("add-repo-error");

  function showError(msg) {
    if (errEl) errEl.textContent = msg || "";
  }

  // Remove a repo from the session.
  document.getElementById("repo-rows")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".repo-remove");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    btn.disabled = true;
    btn.textContent = "Removing…";
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        showError(data.error || `Failed to remove ${id}`);
        btn.disabled = false;
        btn.textContent = "Remove";
      }
    } catch (err) {
      showError("Network error: " + err.message);
      btn.disabled = false;
      btn.textContent = "Remove";
    }
  });

  // Register a new repo with the session.
  const form = document.getElementById("add-repo-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const input = document.getElementById("add-repo-path");
    const path = (input?.value || "").trim();
    if (!path) return;
    const submit = form.querySelector("button");
    if (submit) submit.disabled = true;
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        location.href = data.url || "/session";
      } else {
        showError(data.error || "Failed to add repo");
        if (submit) submit.disabled = false;
      }
    } catch (err) {
      showError("Network error: " + err.message);
      if (submit) submit.disabled = false;
    }
  });
})();
