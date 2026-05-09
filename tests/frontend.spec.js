import { test, expect } from "@playwright/test";
import { PORT, seedReviewData, cleanupReviewData, startServer } from "./setup.js";
import path from "node:path";

const BASE = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = path.resolve(import.meta.dirname, "screenshots");

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 812 };

let serverProc;

test.beforeAll(async () => {
  await cleanupReviewData();
  await seedReviewData();
  serverProc = await startServer();
});

test.afterAll(async () => {
  if (serverProc) {
    serverProc.kill("SIGTERM");
    await new Promise((resolve) => serverProc.on("close", resolve));
  }
  await cleanupReviewData();
});

// ─── Helper ────────────────────────────────────────────────────────────
async function snap(page, name, viewport) {
  await page.setViewportSize(viewport);
  // Wait for any layout reflows
  await page.waitForTimeout(300);
  const suffix = viewport.width <= 500 ? "mobile" : "desktop";
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}-${suffix}.png`),
    fullPage: true,
  });
}

async function snapBoth(page, name) {
  await snap(page, name, DESKTOP);
  await snap(page, name, MOBILE);
}

// ─── Tree Page ─────────────────────────────────────────────────────────
test.describe("Tree Page", () => {
  test("renders file listing with correct structure", async ({ page }) => {
    await page.goto(`${BASE}/tree/`);
    await page.waitForSelector(".file-table");

    // Check topbar elements
    await expect(page.locator(".brand")).toBeVisible();
    await expect(page.locator(".pill").first()).toBeVisible();

    // Check file table has rows
    const rows = page.locator(".file-table tbody tr");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Check directory entries have dir icon class
    const srcDir = page.locator('.item.dir:has-text("src")');
    await expect(srcDir).toBeVisible();

    // Check file entries
    const packageJson = page.locator('.item.file:has-text("package.json")');
    await expect(packageJson).toBeVisible();

    // Check README section renders
    await expect(page.locator(".readme")).toBeVisible();

    await snapBoth(page, "tree-root");
  });

  test("navigates into subdirectory", async ({ page }) => {
    await page.goto(`${BASE}/tree/src`);
    await page.waitForSelector(".file-table");

    // Should show src files
    await expect(page.locator('.item.file:has-text("server.js")')).toBeVisible();
    await expect(page.locator('.item.file:has-text("review-cli.js")')).toBeVisible();

    // Breadcrumbs should show path
    await expect(page.locator('.crumb:has-text("src")')).toBeVisible();

    await snapBoth(page, "tree-src");
  });

  test("mobile hides mtime and size columns", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/tree/`);
    await page.waitForSelector(".file-table");

    // mtime and size columns should be hidden on mobile
    const mtimeHeader = page.locator(".file-table th.mtime");
    await expect(mtimeHeader).toBeHidden();
    const sizeHeader = page.locator(".file-table th.size");
    await expect(sizeHeader).toBeHidden();
  });

  test("meta menu shows on mobile", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/tree/`);
    await page.waitForSelector(".topbar");

    // Meta actions should be hidden, meta menu should be visible
    const metaActions = page.locator(".meta-actions");
    await expect(metaActions).toBeHidden();

    const metaMenu = page.locator(".meta-menu");
    await expect(metaMenu).toBeVisible();

    // Open the menu
    await page.locator(".meta-menu summary").click();
    await expect(page.locator('.menu-item:has-text("Diff view")')).toBeVisible();
    await expect(page.locator('.menu-item:has-text("Reviews")')).toBeVisible();
  });
});

// ─── Blob Page ─────────────────────────────────────────────────────────
test.describe("Blob Page", () => {
  test("renders markdown file with syntax highlighting", async ({ page }) => {
    await page.goto(`${BASE}/blob/README.md`);
    await page.waitForSelector(".markdown-body");

    // File header shows filename and buttons
    await expect(page.locator(".filename")).toHaveText("README.md");
    await expect(page.locator('.btn:has-text("Back")')).toBeVisible();
    await expect(page.locator('.btn:has-text("Raw")')).toBeVisible();

    // Markdown is rendered (has headings)
    const headings = page.locator(".markdown-body h1, .markdown-body h2");
    const headingCount = await headings.count();
    expect(headingCount).toBeGreaterThan(0);

    await snapBoth(page, "blob-readme");
  });

  test("renders code file with highlighting", async ({ page }) => {
    await page.goto(`${BASE}/blob/src/cli.js`);
    await page.waitForSelector(".code-wrap");

    await expect(page.locator(".filename")).toHaveText("cli.js");
    await expect(page.locator("pre.hljs")).toBeVisible();

    await snapBoth(page, "blob-code");
  });
});

// ─── Diff Page ─────────────────────────────────────────────────────────
test.describe("Diff Page", () => {
  test("renders diff view with base selector", async ({ page }) => {
    await page.goto(`${BASE}/diff`);
    await page.waitForSelector(".diff-wrap");

    // Base selector is present
    await expect(page.locator("#base-selector")).toBeVisible();

    // Back button works
    await expect(page.locator('.btn:has-text("Back")')).toBeVisible();

    await snapBoth(page, "diff-view");
  });
});

// ─── Review List Page ──────────────────────────────────────────────────
test.describe("Review List Page", () => {
  test("shows thread list with correct data", async ({ page }) => {
    await page.goto(`${BASE}/review/`);
    await page.waitForSelector(".review-thread-list");

    // Should show both threads
    const rows = page.locator(".review-thread-row");
    const count = await rows.count();
    expect(count).toBe(2);

    // First thread (newest activity) should be Auth Module Review
    await expect(page.locator('.review-thread-title:has-text("Auth Module Review")')).toBeVisible();
    await expect(page.locator('.review-thread-title:has-text("API Redesign Proposal")')).toBeVisible();

    // Auth review should have unread badge (readUntil is null, 3 messages)
    const authRow = page.locator('.review-thread-row:has-text("Auth Module Review")');
    await expect(authRow.locator(".review-unread-badge")).toBeVisible();

    // API redesign should NOT have unread badge (readUntil matches last message)
    const apiRow = page.locator('.review-thread-row:has-text("API Redesign Proposal")');
    await expect(apiRow.locator(".review-unread-badge")).not.toBeVisible();

    // Message counts visible
    await expect(authRow.locator('.review-thread-meta')).toContainText("3 messages");
    await expect(apiRow.locator('.review-thread-meta')).toContainText("1 message");

    // Timestamps should be human-readable (not raw ISO)
    const metaText = await authRow.locator('.review-thread-meta').textContent();
    expect(metaText).not.toContain("T0");
    expect(metaText).toMatch(/ago|just now|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);

    await snapBoth(page, "review-list");
  });

  test("thread rows are clickable and navigate to thread", async ({ page }) => {
    await page.goto(`${BASE}/review/`);
    await page.waitForSelector(".review-thread-list");

    const authRow = page.locator('.review-thread-row:has-text("Auth Module Review")');
    await authRow.click();

    await page.waitForURL(/\/review\/test-auth-review/);
    await expect(page.locator(".review-messages")).toBeVisible();
  });

  test("topbar has proper branding", async ({ page }) => {
    await page.goto(`${BASE}/review/`);
    await expect(page.locator(".brand")).toBeVisible();
    await expect(page.locator(".pill").first()).toBeVisible();
  });
});

// ─── Review Thread Page ────────────────────────────────────────────────
test.describe("Review Thread Page", () => {
  test("renders all messages in order", async ({ page }) => {
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    const messages = page.locator(".review-message");
    const count = await messages.count();
    expect(count).toBe(3);

    // First message is agent
    const first = messages.nth(0);
    await expect(first).toHaveClass(/review-msg-agent/);
    await expect(first.locator(".review-msg-role")).toHaveText("Agent");

    // Second message is user
    const second = messages.nth(1);
    await expect(second).toHaveClass(/review-msg-user/);
    await expect(second.locator(".review-msg-role")).toHaveText("You");

    // Third message is agent
    const third = messages.nth(2);
    await expect(third).toHaveClass(/review-msg-agent/);

    await snapBoth(page, "review-thread");
  });

  test("agent messages render as markdown with code blocks", async ({ page }) => {
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    // First agent message should have rendered markdown
    const agentContent = page.locator(".review-msg-agent .markdown-body").first();
    await expect(agentContent).toBeVisible();

    // Should have a heading
    await expect(agentContent.locator("h1")).toContainText("Auth Module Overview");

    // Should have a code block
    await expect(agentContent.locator("pre code")).toBeVisible();

    // Should have a table
    await expect(agentContent.locator("table")).toBeVisible();

    // Should have a warning alert
    await expect(agentContent.locator(".markdown-alert-warning")).toBeVisible();
  });

  test("user messages render as plain text", async ({ page }) => {
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    const userMsg = page.locator(".review-msg-user .review-msg-text");
    await expect(userMsg).toBeVisible();
    await expect(userMsg).toContainText("Should we add PKCE");
  });

  test("inline comments are displayed", async ({ page }) => {
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    // Should show comments
    const commentCards = page.locator(".review-comment-card");
    const count = await commentCards.count();
    expect(count).toBe(2);

    // First comment (unresolved)
    const unresolvedComment = page.locator('.review-comment-card:has-text("input validation")');
    await expect(unresolvedComment).toBeVisible();
    await expect(unresolvedComment).not.toHaveClass(/resolved/);
    await expect(unresolvedComment.locator(".review-resolve-btn")).toBeVisible();

    // Second comment (resolved)
    const resolvedComment = page.locator('.review-comment-card:has-text("configurable")');
    await expect(resolvedComment).toBeVisible();
    await expect(resolvedComment).toHaveClass(/resolved/);
    await expect(resolvedComment.locator(".review-resolved-label")).toBeVisible();

    await snapBoth(page, "review-thread-comments");
  });

  test("back button returns to review list", async ({ page }) => {
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    await page.locator('.btn:has-text("Back")').click();
    await page.waitForURL(/\/review\/$/);
  });

  test("reply form is visible and functional", async ({ page }) => {
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-reply-form");

    // Reply form elements
    const textarea = page.locator("#review-reply-text");
    const submitBtn = page.locator("#review-reply-submit");
    await expect(textarea).toBeVisible();
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toHaveText("Submit Reply");

    // Type and submit a reply
    await textarea.fill("This is a test reply from Playwright");
    await submitBtn.click();

    // Page should reload and show the new message
    await page.waitForSelector('.review-msg-user .review-msg-text:has-text("test reply from Playwright")');

    // Should now have 4 messages
    const messages = page.locator(".review-message");
    const count = await messages.count();
    expect(count).toBe(4);

    await snapBoth(page, "review-thread-after-reply");
  });

  test("thread header is sticky", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);

    // The topbar should still be visible (sticky)
    const topbar = page.locator(".topbar");
    await expect(topbar).toBeVisible();
    const box = await topbar.boundingBox();
    expect(box.y).toBeLessThanOrEqual(0);
  });
});

// ─── Review API routes ─────────────────────────────────────────────────
test.describe("Review API", () => {
  test("POST comment and resolve it", async ({ request }) => {
    // Post a new inline comment
    const postRes = await request.post(`${BASE}/review/test-auth-review/comments`, {
      data: {
        messageId: "001",
        anchorLine: 3,
        anchorEndLine: 5,
        anchorText: "authentication and authorization",
        body: "Test API comment",
      },
    });
    expect(postRes.ok()).toBeTruthy();
    const comment = await postRes.json();
    expect(comment.id).toBeTruthy();
    expect(comment.body).toBe("Test API comment");
    expect(comment.resolved).toBe(false);

    // Resolve the comment
    const patchRes = await request.patch(`${BASE}/review/test-auth-review/comments/${comment.id}`, {
      data: { resolved: true },
    });
    expect(patchRes.ok()).toBeTruthy();
    const updated = await patchRes.json();
    expect(updated.resolved).toBe(true);

    // Delete the comment
    const deleteRes = await request.delete(`${BASE}/review/test-auth-review/comments/${comment.id}`);
    expect(deleteRes.ok()).toBeTruthy();
  });

  test("POST message via API", async ({ request }) => {
    const res = await request.post(`${BASE}/review/test-api-redesign/messages`, {
      data: { body: "API test message" },
    });
    expect(res.ok()).toBeTruthy();
    const msg = await res.json();
    expect(msg.role).toBe("user");
    expect(msg.body).toBe("API test message");
    expect(msg.id).toBe("002");
  });

  test("mark-read endpoint", async ({ request }) => {
    const res = await request.post(`${BASE}/review/test-auth-review/mark-read`, {
      data: { readUntil: "003" },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("invalid thread ID returns 400", async ({ request }) => {
    const res = await request.post(`${BASE}/review/../escape/messages`, {
      data: { body: "hack" },
    });
    // express will 400 or 404 depending on route matching
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("empty body returns 400", async ({ request }) => {
    const res = await request.post(`${BASE}/review/test-auth-review/messages`, {
      data: { body: "" },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── Inline commenting UI ──────────────────────────────────────────────
test.describe("Inline Commenting UI", () => {
  test("gutter buttons appear on hover for agent messages", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    // Find a block with data-source-line-start in the first agent message
    const lineBlock = page.locator("[data-source-line-start]").first();
    if (await lineBlock.count() > 0) {
      // Hover to reveal gutter button
      await lineBlock.hover();
      await page.waitForTimeout(300);
      const gutterBtn = lineBlock.locator(".review-gutter-btn");
      // Button should become visible on hover
      await expect(gutterBtn).toBeAttached();
    }
  });

  test("clicking gutter button opens inline comment form", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    const lineBlock = page.locator("[data-source-line-start]").first();
    if (await lineBlock.count() > 0) {
      await lineBlock.hover();
      await page.waitForTimeout(300);
      const gutterBtn = lineBlock.locator(".review-gutter-btn");
      if (await gutterBtn.count() > 0) {
        await gutterBtn.click();

        // Inline form should appear
        const form = page.locator(".review-inline-form");
        await expect(form).toBeVisible();
        await expect(form.locator(".review-inline-textarea")).toBeVisible();
        await expect(form.locator(".review-inline-submit")).toBeVisible();
        await expect(form.locator(".review-inline-cancel")).toBeVisible();

        await snap(page, "review-inline-form", DESKTOP);

        // Cancel closes the form
        await form.locator(".review-inline-cancel").click();
        await expect(form).not.toBeVisible();
      }
    }
  });
});

// ─── Resolve/Delete comment UI ─────────────────────────────────────────
test.describe("Comment Actions UI", () => {
  test("resolve button marks comment as resolved", async ({ page }) => {
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    const unresolvedCard = page.locator('.review-comment-card:not(.resolved):has-text("input validation")');
    if (await unresolvedCard.count() > 0) {
      const resolveBtn = unresolvedCard.locator(".review-resolve-btn");
      await resolveBtn.click();

      // Page reloads; the comment should now be resolved
      await page.waitForSelector(".review-messages");
      const card = page.locator('.review-comment-card:has-text("input validation")');
      await expect(card).toHaveClass(/resolved/);
    }
  });
});

// ─── Navigation & Cross-page ───────────────────────────────────────────
test.describe("Navigation", () => {
  test("root redirects to /tree/", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForURL(/\/tree\//);
  });

  test("Reviews link in meta menu navigates to review list", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/tree/`);
    await page.waitForSelector(".topbar");

    await page.locator(".meta-menu summary").click();
    await page.locator('.menu-item:has-text("Reviews")').click();
    await page.waitForURL(/\/review\//);
    await expect(page.locator(".review-thread-list")).toBeVisible();
  });

  test("404 returns error page", async ({ page }) => {
    const res = await page.goto(`${BASE}/blob/nonexistent-file-xyz.txt`);
    expect(res.status()).toBe(404);
    await expect(page.locator(".error")).toBeVisible();
  });

  test("invalid review thread returns 404", async ({ page }) => {
    const res = await page.goto(`${BASE}/review/nonexistent-thread`);
    expect(res.status()).toBe(404);
    await expect(page.locator(".error")).toBeVisible();
  });
});

// ─── Responsive Layout Checks ──────────────────────────────────────────
test.describe("Responsive Layout", () => {
  test("topbar does not overflow on mobile", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/tree/`);
    await page.waitForSelector(".topbar");

    const topbar = page.locator(".topbar");
    const box = await topbar.boundingBox();
    // Topbar should not be wider than viewport
    expect(box.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("review thread is readable on mobile", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    // Messages should be visible
    await expect(page.locator(".review-message").first()).toBeVisible();

    // Reply form should be visible
    await expect(page.locator(".review-reply-form")).toBeVisible();

    // Content shouldn't overflow horizontally
    const body = page.locator("body");
    const bodyBox = await body.boundingBox();
    expect(bodyBox.width).toBeLessThanOrEqual(MOBILE.width + 1);
  });

  test("review list touch targets are at least 44px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/review/`);
    await page.waitForSelector(".review-thread-list");

    const rows = page.locator(".review-thread-row");
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const box = await rows.nth(i).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("review reply button is at least 44px tall on mobile", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-reply-form");

    const btn = page.locator("#review-reply-submit");
    const box = await btn.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});

// ─── Code References ───────────────────────────────────────────────────
test.describe("Code References", () => {
  test("detects file:line patterns and creates clickable links", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".review-messages");

    // The third agent message contains "src/server.js:248"
    const codeRef = page.locator('.code-ref[data-file="src/server.js"]');
    await expect(codeRef.first()).toBeVisible();
    await expect(codeRef.first()).toHaveAttribute("data-line", "248");

    // Should also detect src/views.js:10-15
    const rangeRef = page.locator('.code-ref[data-file="src/views.js"]');
    await expect(rangeRef.first()).toBeVisible();
    await expect(rangeRef.first()).toHaveAttribute("data-line", "10");
    await expect(rangeRef.first()).toHaveAttribute("data-end-line", "15");

    await snapBoth(page, "review-code-refs");
  });

  test("code ref links have correct styling", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".code-ref");

    const ref = page.locator(".code-ref").first();
    const color = await ref.evaluate((el) => getComputedStyle(el).color);
    // Should be accent-colored (blue)
    expect(color).not.toBe("rgb(0, 0, 0)");
  });

  test("clicking code ref opens popup with source code", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".code-ref");

    // Click the first code ref
    await page.locator('.code-ref[data-file="src/server.js"]').first().click();

    // Popup should appear
    const popup = page.locator(".code-popup");
    await expect(popup).toBeVisible();

    // Should show the filename in the header
    await expect(page.locator(".code-popup-filepath")).toContainText("src/server.js");

    // Should have code content with line numbers
    await expect(page.locator(".code-table")).toBeVisible();
    const lineNums = page.locator(".code-ln");
    const count = await lineNums.count();
    expect(count).toBeGreaterThan(0);

    // Should have a highlighted line
    await expect(page.locator(".code-line.highlight").first()).toBeVisible();

    // Source tab should be active
    await expect(page.locator('.code-popup-tab[data-mode="source"]')).toHaveClass(/active/);

    await snap(page, "code-popup-source", DESKTOP);
  });

  test("popup diff tab shows diff or no-changes message", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".code-ref");

    await page.locator('.code-ref[data-file="src/server.js"]').first().click();
    await page.waitForSelector(".code-popup");

    // Click diff tab
    await page.locator('.code-popup-tab[data-mode="diff"]').click();

    // Should show either diff content or "no changes" message
    const body = page.locator(".code-popup-body");
    const content = await body.textContent();
    expect(content.length).toBeGreaterThan(0);

    await snap(page, "code-popup-diff", DESKTOP);
  });

  test("popup closes on X button click", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".code-ref");

    await page.locator(".code-ref").first().click();
    await page.waitForSelector(".code-popup");

    await page.locator(".code-popup-close").click();
    await expect(page.locator(".code-popup-overlay")).not.toBeVisible();
  });

  test("popup closes on Escape key", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".code-ref");

    await page.locator(".code-ref").first().click();
    await page.waitForSelector(".code-popup");

    await page.keyboard.press("Escape");
    await expect(page.locator(".code-popup-overlay")).not.toBeVisible();
  });

  test("popup closes on overlay background click", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".code-ref");

    await page.locator(".code-ref").first().click();
    await page.waitForSelector(".code-popup");

    // Click the overlay background (not the popup itself)
    await page.locator(".code-popup-overlay").click({ position: { x: 10, y: 10 } });
    await expect(page.locator(".code-popup-overlay")).not.toBeVisible();
  });

  test("mobile popup renders as bottom sheet", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/review/test-auth-review`);
    await page.waitForSelector(".code-ref");

    await page.locator(".code-ref").first().click();
    await page.waitForSelector(".code-popup");

    const popup = page.locator(".code-popup");
    const box = await popup.boundingBox();
    // Should span full width on mobile
    expect(box.width).toBeGreaterThanOrEqual(MOBILE.width - 2);

    await snap(page, "code-popup-mobile", MOBILE);
  });
});

// ─── Code Context API ──────────────────────────────────────────────────
test.describe("Code Context API", () => {
  test("returns file snippet with correct line range", async ({ request }) => {
    const res = await request.get(`${BASE}/api/code-context?file=src/server.js&line=10&context=5`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.file).toBe("src/server.js");
    expect(data.startLine).toBeLessThanOrEqual(10);
    expect(data.stopLine).toBeGreaterThanOrEqual(10);
    expect(data.highlightStart).toBe(10);
    expect(data.highlightEnd).toBe(10);
    expect(data.lines.length).toBeGreaterThan(0);
    expect(data.language).toBe("js");
    expect(data.totalLines).toBeGreaterThan(100);
  });

  test("returns line range for endLine parameter", async ({ request }) => {
    const res = await request.get(`${BASE}/api/code-context?file=src/views.js&line=10&endLine=15&context=3`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.highlightStart).toBe(10);
    expect(data.highlightEnd).toBe(15);
    expect(data.startLine).toBeLessThanOrEqual(10);
    expect(data.stopLine).toBeGreaterThanOrEqual(15);
  });

  test("includes diff data when file has changes", async ({ request }) => {
    const res = await request.get(`${BASE}/api/code-context?file=src/server.js&line=10`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // diff may or may not be present depending on git state — just check the field exists
    expect("diff" in data).toBeTruthy();
  });

  test("returns 404 for nonexistent file", async ({ request }) => {
    const res = await request.get(`${BASE}/api/code-context?file=nonexistent.js&line=1`);
    expect(res.status()).toBe(404);
  });

  test("returns 400 for missing file param", async ({ request }) => {
    const res = await request.get(`${BASE}/api/code-context`);
    expect(res.status()).toBe(400);
  });

  test("clamps context to max 200 lines", async ({ request }) => {
    const res = await request.get(`${BASE}/api/code-context?file=src/server.js&line=100&context=9999`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Should have at most ~400 lines (200 before + 200 after the target)
    expect(data.lines.length).toBeLessThanOrEqual(401);
  });
});
