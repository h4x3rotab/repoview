(() => {
  // Delete button on the gist preview page.
  const del = document.querySelector(".gist-delete");
  if (del) {
    del.addEventListener("click", async () => {
      if (!confirm("Delete this gist? This cannot be undone.")) return;
      del.disabled = true;
      try {
        const res = await fetch(`/api/gists/${encodeURIComponent(del.dataset.id)}`, {
          method: "DELETE",
        });
        if (res.ok) {
          location.href = "/gists";
        } else {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Failed to delete gist");
          del.disabled = false;
        }
      } catch (e) {
        alert("Network error: " + e.message);
        del.disabled = false;
      }
    });
  }

  // Edit form.
  const form = document.getElementById("gist-edit-form");
  if (form) {
    const errEl = document.getElementById("gist-edit-error");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errEl) errEl.textContent = "";
      const id = form.dataset.gistId;
      const body = {
        content: document.getElementById("gist-content").value,
        filename: document.getElementById("gist-filename").value,
        title: document.getElementById("gist-title").value,
      };
      const submit = form.querySelector("button[type=submit]");
      if (submit) submit.disabled = true;
      try {
        const res = await fetch(`/api/gists/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          location.href = `/gist/${encodeURIComponent(id)}`;
        } else {
          const data = await res.json().catch(() => ({}));
          if (errEl) errEl.textContent = data.error || "Failed to save";
          if (submit) submit.disabled = false;
        }
      } catch (err) {
        if (errEl) errEl.textContent = "Network error: " + err.message;
        if (submit) submit.disabled = false;
      }
    });
  }
})();
