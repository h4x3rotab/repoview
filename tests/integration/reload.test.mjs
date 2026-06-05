// Unit coverage for scoped live-reload: a client is only notified when a
// changed path matches its scope (exact file / viewed dir / all).
import test from "node:test";
import assert from "node:assert/strict";

import { createReloadHub } from "../../dist/reload.js";

function mockClient() {
  return {
    reloads: 0,
    write(s) {
      if (s.includes("event: reload")) this.reloads++;
      return true;
    },
    end() {},
    on() {},
  };
}

test("file scope reloads only on its exact file", () => {
  const hub = createReloadHub();
  const match = mockClient();
  const other = mockClient();
  hub.add(match, { type: "file", path: "docs/a.md" });
  hub.add(other, { type: "file", path: "docs/b.md" });
  hub.notify(["docs/a.md"]);
  assert.equal(match.reloads, 1);
  assert.equal(other.reloads, 0);
});

test("dir scope reloads on a direct child, not a nested or sibling change", () => {
  const hub = createReloadHub();
  const docs = mockClient();
  const root = mockClient();
  hub.add(docs, { type: "dir", path: "docs" });
  hub.add(root, { type: "dir", path: "" });

  hub.notify(["docs/new.md"]); // direct child of docs/
  assert.equal(docs.reloads, 1);
  assert.equal(root.reloads, 0);

  hub.notify(["docs/sub/deep.md"]); // nested — not a direct child of docs/
  assert.equal(docs.reloads, 1, "no reload for nested change");

  hub.notify(["top.md"]); // top-level file → matches root dir ""
  assert.equal(root.reloads, 1);
});

test("all scope reloads on any change", () => {
  const hub = createReloadHub();
  const all = mockClient();
  hub.add(all, { type: "all" });
  hub.notify(["anything.txt"]);
  assert.equal(all.reloads, 1);
});

test("revision bumps on every notify (polling fallback stays coarse)", () => {
  const hub = createReloadHub();
  hub.add(mockClient(), { type: "file", path: "x" });
  const r0 = hub.getRevision();
  hub.notify(["unrelated.md"]); // no client match, but revision still advances
  assert.equal(hub.getRevision(), r0 + 1);
});
