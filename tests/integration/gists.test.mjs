// Tests for the ephemeral gist store + HTTP routes.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { createGistStore } from "../../dist/gists.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("gist store", () => {
  test("create / get / list round-trip", () => {
    const store = createGistStore();
    const g = store.create({ content: "# hi", filename: "a.md", title: "Hi" });
    assert.match(g.id, /^[A-Za-z0-9_-]+$/);
    assert.equal(g.filename, "a.md");
    assert.equal(g.title, "Hi");
    assert.equal(store.get(g.id).content, "# hi");
    assert.equal(store.list().length, 1);
    store.close();
  });

  test("expires after its TTL", async () => {
    const store = createGistStore({ minTtlMs: 10, defaultTtlMs: 30 });
    const g = store.create({ content: "x", filename: "x.txt", ttlMs: 20 });
    assert.ok(store.get(g.id), "present before expiry");
    await sleep(40);
    assert.equal(store.get(g.id), undefined, "gone after expiry");
    assert.equal(store.list().length, 0);
    store.close();
  });

  test("rejects empty and oversized content", () => {
    const store = createGistStore({ maxContentBytes: 16 });
    assert.throws(() => store.create({ content: "" }), /content is required/);
    assert.throws(() => store.create({ content: "x".repeat(17) }), /too large/);
    store.close();
  });

  test("filename is sanitized to a basename", () => {
    const store = createGistStore();
    const g = store.create({ content: "x", filename: "../../etc/passwd" });
    assert.equal(g.filename, "passwd");
    store.close();
  });

  test("evicts the oldest when at capacity", () => {
    const store = createGistStore({ maxGists: 2 });
    const a = store.create({ content: "a", filename: "a" });
    store.create({ content: "b", filename: "b" });
    store.create({ content: "c", filename: "c" }); // evicts a
    assert.equal(store.get(a.id), undefined);
    assert.equal(store.list().length, 2);
    store.close();
  });

  test("update patches only provided fields and keeps createdAt", () => {
    const store = createGistStore();
    const g = store.create({ content: "old", filename: "a.md", title: "A" });
    const u = store.update(g.id, { content: "new", title: "B" });
    assert.equal(u.content, "new");
    assert.equal(u.title, "B");
    assert.equal(u.filename, "a.md", "untouched field preserved");
    assert.equal(u.createdAt, g.createdAt);
    store.close();
  });

  test("update of a missing id returns undefined", () => {
    const store = createGistStore();
    assert.equal(store.update("nope", { title: "x" }), undefined);
    store.close();
  });

  test("delete removes a gist", () => {
    const store = createGistStore();
    const g = store.create({ content: "x", filename: "x" });
    assert.equal(store.delete(g.id), true);
    assert.equal(store.get(g.id), undefined);
    assert.equal(store.delete(g.id), false);
    store.close();
  });
});

describe("gist HTTP routes", () => {
  let tmp, running, base;

  before(async () => {
    process.env.REPOVIEW_BASE_URL = "https://gists.example.com";
    const { startServer } = await import("../../dist/server.js");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repoview-gist-"));
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, "README.md"), "# repo\n");
    const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("add", "-A");
    git("commit", "-qm", "init");
    running = await startServer({ repoRoot: repo, host: "127.0.0.1", port: 0, watch: false });
    base = `http://127.0.0.1:${running.server.address().port}`;
  });

  after(async () => {
    delete process.env.REPOVIEW_BASE_URL;
    await new Promise((r) => running.server.close(r));
    await running.session.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function publish(body) {
    const res = await fetch(`${base}/api/gists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, json: await res.json() };
  }

  test("POST /api/gists returns a URL using REPOVIEW_BASE_URL", async () => {
    const { res, json } = await publish({ content: "# Hi\n\ntext", filename: "n.md", title: "N" });
    assert.equal(res.status, 201);
    assert.match(json.url, /^https:\/\/gists\.example\.com\/gist\/[A-Za-z0-9_-]+$/);
    assert.equal(json.rawUrl, `${json.url}/raw`);
    assert.ok(json.expiresAt);
  });

  test("GET /gist/:id renders markdown; /raw returns the source", async () => {
    const { json } = await publish({ content: "# Title\n\nbody", filename: "x.md" });
    const id = json.url.split("/").pop();
    const html = await (await fetch(`${base}/gist/${id}`)).text();
    assert.match(html, /<h1[\s\S]*?>Title</);
    assert.match(html, /markdown-body/);
    const raw = await (await fetch(`${base}/gist/${id}/raw`)).text();
    assert.equal(raw, "# Title\n\nbody");
  });

  test("non-markdown gists render as highlighted code", async () => {
    const { json } = await publish({ content: "const x = 1;", filename: "a.js" });
    const id = json.url.split("/").pop();
    const html = await (await fetch(`${base}/gist/${id}`)).text();
    assert.match(html, /hljs|<pre/);
  });

  test("GET /gists lists active gists", async () => {
    const { json } = await publish({ content: "listed", filename: "listed.md", title: "Listed" });
    const id = json.url.split("/").pop();
    const html = await (await fetch(`${base}/gists`)).text();
    assert.match(html, new RegExp(`/gist/${id}`));
    assert.match(html, /Listed/);
  });

  test("missing gist returns 404; invalid id returns 400", async () => {
    assert.equal((await fetch(`${base}/gist/doesnotexist1`)).status, 404);
    assert.equal((await fetch(`${base}/gist/bad..id`)).status, 400);
  });

  test("empty content is rejected (400)", async () => {
    const { res } = await publish({ content: "" });
    assert.equal(res.status, 400);
  });

  test("PATCH edits a gist; GET reflects the change", async () => {
    const { json } = await publish({ content: "# Old\n", filename: "e.md", title: "Old" });
    const id = json.url.split("/").pop();
    const res = await fetch(`${base}/api/gists/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "# Brand New\n", title: "New" }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.title, "New");
    const raw = await (await fetch(`${base}/gist/${id}/raw`)).text();
    assert.equal(raw, "# Brand New\n");
  });

  test("GET /gist/:id/edit serves an edit form", async () => {
    const { json } = await publish({ content: "x", filename: "f.md" });
    const id = json.url.split("/").pop();
    const html = await (await fetch(`${base}/gist/${id}/edit`)).text();
    assert.match(html, /id="gist-edit-form"/);
    assert.match(html, /id="gist-content"/);
  });

  test("GET /api/gists lists gists as JSON", async () => {
    const { json } = await publish({ content: "listed", filename: "l.md", title: "L" });
    const id = json.url.split("/").pop();
    const data = await (await fetch(`${base}/api/gists`)).json();
    assert.ok(Array.isArray(data.gists));
    assert.ok(data.gists.some((g) => g.id === id && g.title === "L"));
  });

  test("DELETE removes a gist (then 404)", async () => {
    const { json } = await publish({ content: "bye", filename: "d.md" });
    const id = json.url.split("/").pop();
    assert.equal((await fetch(`${base}/api/gists/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${base}/gist/${id}`)).status, 404);
    assert.equal((await fetch(`${base}/api/gists/${id}`, { method: "DELETE" })).status, 404);
  });

  test("PATCH / DELETE of a missing id return 404", async () => {
    assert.equal(
      (
        await fetch(`${base}/api/gists/doesnotexist1`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      404,
    );
    assert.equal((await fetch(`${base}/api/gists/doesnotexist1`, { method: "DELETE" })).status, 404);
  });
});
