// Unit coverage for the loopback helpers and the session page's canManage gating.
import test from "node:test";
import assert from "node:assert/strict";

import { isLoopbackAddress, isLoopbackHost } from "../../dist/net.js";
import { renderSessionPage } from "../../dist/views.js";

test("isLoopbackAddress recognizes loopback remotes only", () => {
  for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(a), true, a);
  }
  for (const a of ["192.168.1.5", "10.0.0.2", "::ffff:10.0.0.2", "", undefined, null]) {
    assert.equal(isLoopbackAddress(a), false, String(a));
  }
});

test("isLoopbackHost distinguishes local-only binds", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("192.168.1.5"), false);
});

const repos = [{ id: "alpha", name: "alpha", path: "/x/alpha", branch: "main" }];

test("session page shows management controls when canManage is true", () => {
  const html = renderSessionPage({ repos, canManage: true });
  assert.match(html, /repo-remove/);
  assert.match(html, /id="add-repo-form"/);
  assert.match(html, /static\/session\.js/);
});

test("session page hides management controls when canManage is false", () => {
  const html = renderSessionPage({ repos, canManage: false });
  assert.doesNotMatch(html, /repo-remove/);
  assert.doesNotMatch(html, /id="add-repo-form"/);
  assert.doesNotMatch(html, /static\/session\.js/);
  assert.match(html, /only be added or removed from the host/);
});
