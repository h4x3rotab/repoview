// Integration tests for the multi-repo session feature.
// Boots the server in-process (from the built dist/) and drives it over HTTP.
// Run with: npm test  (which builds first, then `node --test tests/integration/`)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { startServer } from "../../dist/server.js";

/** Create a throwaway git repo with the given files; returns its path. */
function makeRepo(parent, name, files) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

let tmp;
let running;
let base;
let defaultId;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repoview-it-"));
  // Default repo "alpha" with a README that links to a sibling doc.
  const alpha = makeRepo(tmp, "alpha", {
    "README.md": "# Alpha\n\nSee [the guide](GUIDE.md) for details.\n",
    "GUIDE.md": "# Guide\n",
  });
  running = await startServer({ repoRoot: alpha, host: "127.0.0.1", port: 0, watch: false });
  base = `http://127.0.0.1:${running.server.address().port}`;
  defaultId = running.session.getDefaultId();
});

after(async () => {
  await new Promise((r) => running.server.close(r));
  await running.session.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("GET /api/session returns the repoview signature + repos", async () => {
  const res = await fetch(`${base}/api/session`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.app, "repoview");
  assert.ok(json.version, "has a version");
  assert.equal(json.repos.length, 1);
  assert.equal(json.repos[0].id, "alpha");
});

test("GET / redirects to the default repo tree", async () => {
  const res = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/r/${defaultId}/tree/`);
});

test("default repo tree renders with data-repo-base", async () => {
  const res = await fetch(`${base}/r/${defaultId}/tree/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /data-repo-base="\/r\/alpha"/);
  assert.match(html, /Alpha/);
});

test("markdown content links are prefixed once (no double prefix)", async () => {
  const html = await (await fetch(`${base}/r/${defaultId}/tree/`)).text();
  assert.match(html, /href="\/r\/alpha\/blob\/GUIDE\.md"/);
  assert.doesNotMatch(html, /\/blob\/r\/alpha/, "must not double-prefix");
});

test("legacy /tree URL 307-redirects to the default repo, preserving path+query", async () => {
  const res = await fetch(`${base}/tree/GUIDE.md?ignored=1`, { redirect: "manual" });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), `/r/${defaultId}/tree/GUIDE.md?ignored=1`);
});

test("POST /api/repos registers a second repo", async () => {
  const beta = makeRepo(tmp, "beta", { "README.md": "# Beta\n" });
  const res = await fetch(`${base}/api/repos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: beta, watch: false }),
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.id, "beta");
  assert.equal(json.url, "/r/beta/tree/");

  const list = await (await fetch(`${base}/api/repos`)).json();
  assert.equal(list.repos.length, 2);
});

test("registering the same path again is idempotent", async () => {
  const beta = path.join(tmp, "beta");
  const res = await fetch(`${base}/api/repos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: beta, watch: false }),
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.id, "beta");
  const list = await (await fetch(`${base}/api/repos`)).json();
  assert.equal(list.repos.length, 2, "still two repos");
});

test("same-basename repo gets a disambiguated id", async () => {
  // A different directory also named "beta".
  const sub = path.join(tmp, "nested");
  const beta2 = makeRepo(sub, "beta", { "README.md": "# Beta two\n" });
  const res = await fetch(`${base}/api/repos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: beta2, watch: false }),
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.id, "beta-2");
});

test("topbar shows the repo switcher with links to the other repos", async () => {
  const html = await (await fetch(`${base}/r/${defaultId}/tree/`)).text();
  assert.match(html, /repo-switcher/);
  assert.match(html, /href="\/r\/beta\/tree\/"/);
  assert.match(html, /href="\/session"/, "switcher links to manage page");
});

test("each repo renders its own content", async () => {
  const html = await (await fetch(`${base}/r/beta/tree/`)).text();
  assert.match(html, /Beta/);
  assert.match(html, /data-repo-base="\/r\/beta"/);
});

test("GET /session lists every repo", async () => {
  const html = await (await fetch(`${base}/session`)).text();
  assert.match(html, /Repositories/);
  assert.match(html, /\/r\/alpha\/tree\//);
  assert.match(html, /\/r\/beta\/tree\//);
});

test("unknown repo falls back to the session page with a notice (404)", async () => {
  const res = await fetch(`${base}/r/does-not-exist/tree/`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /is not in this session/);
});

test("DELETE /api/repos/:id unregisters a repo", async () => {
  const res = await fetch(`${base}/api/repos/beta-2`, { method: "DELETE" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);

  const removed = await fetch(`${base}/r/beta-2/tree/`);
  assert.equal(removed.status, 404);

  const list = await (await fetch(`${base}/api/repos`)).json();
  assert.equal(list.repos.length, 2);
});

test("DELETE of an unknown id returns 404", async () => {
  const res = await fetch(`${base}/api/repos/ghost`, { method: "DELETE" });
  assert.equal(res.status, 404);
});

test("POST /api/repos rejects a missing path", async () => {
  const res = await fetch(`${base}/api/repos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("core routes still work under the repo prefix", async () => {
  for (const route of ["/diff", "/review/", "/broken-links", "/rev", "/raw/README.md"]) {
    const res = await fetch(`${base}/r/${defaultId}${route}`);
    assert.ok(res.ok, `${route} -> ${res.status}`);
  }
});
