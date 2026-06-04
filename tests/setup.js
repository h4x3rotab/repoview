import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 3111;
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REVIEW_DIR = path.join(REPO_ROOT, ".repoview", "reviews");

/** Seed review data for testing */
async function seedReviewData() {
  // Create a thread
  const threadId = "test-auth-review";
  const threadDir = path.join(REVIEW_DIR, threadId);
  const messagesDir = path.join(threadDir, "messages");
  await fs.mkdir(messagesDir, { recursive: true });

  const now = new Date().toISOString();

  await fs.writeFile(
    path.join(threadDir, "thread.json"),
    JSON.stringify({
      id: threadId,
      title: "Auth Module Review",
      createdAt: now,
      lastActivityAt: now,
      readUntil: null,
    }, null, 2) + "\n",
  );

  await fs.writeFile(
    path.join(messagesDir, "001.json"),
    JSON.stringify({
      id: "001",
      role: "agent",
      format: "markdown",
      body: `# Auth Module Overview

This module handles **authentication** and **authorization** for the application.

## Architecture

The auth flow uses JWT tokens with refresh token rotation:

\`\`\`js
async function authenticate(credentials) {
  const user = await findUser(credentials.email);
  if (!user) throw new AuthError("Invalid credentials");
  const valid = await bcrypt.compare(credentials.password, user.hash);
  if (!valid) throw new AuthError("Invalid credentials");
  return generateTokenPair(user);
}
\`\`\`

## Key Decisions

1. **JWT over sessions** — stateless, scales horizontally
2. **Refresh rotation** — mitigates token theft
3. **Rate limiting** — 5 attempts per minute per IP

> [!WARNING]
> The current implementation stores refresh tokens in localStorage. Consider httpOnly cookies for production.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| jsonwebtoken | 9.0.0 | Token signing/verification |
| bcrypt | 5.1.0 | Password hashing |
| express-rate-limit | 7.1.0 | Rate limiting middleware |`,
      createdAt: now,
    }, null, 2) + "\n",
  );

  await fs.writeFile(
    path.join(messagesDir, "002.json"),
    JSON.stringify({
      id: "002",
      role: "user",
      format: "text",
      body: "Looks good overall. A few questions:\n\n1. Should we add PKCE for the OAuth flow?\n2. What's the token expiry time?\n3. Can we add audit logging for failed attempts?",
      createdAt: new Date(Date.now() + 60000).toISOString(),
    }, null, 2) + "\n",
  );

  await fs.writeFile(
    path.join(messagesDir, "003.json"),
    JSON.stringify({
      id: "003",
      role: "agent",
      format: "markdown",
      body: `Great questions! Here are my responses:

1. **PKCE** — Yes, absolutely. I'll add PKCE support in the next iteration. It's essential for public clients.

2. **Token expiry** — Currently set to:
   - Access token: 15 minutes
   - Refresh token: 7 days

3. **Audit logging** — I'll add a \`logAuthEvent()\` function:

\`\`\`js
function logAuthEvent(type, { ip, email, success }) {
  const entry = { type, ip, email, success, timestamp: Date.now() };
  authAuditLog.append(entry);
}
\`\`\`

This will capture all auth attempts for security monitoring.

See the implementation at src/server.js:248 and also check src/views.js:10-15 for the escaping logic.`,
      createdAt: new Date(Date.now() + 120000).toISOString(),
    }, null, 2) + "\n",
  );

  await fs.writeFile(
    path.join(threadDir, "comments.json"),
    JSON.stringify({
      comments: [
        {
          id: "c_test_001",
          messageId: "001",
          anchorLine: 7,
          anchorEndLine: 14,
          anchorText: "async function authenticate",
          body: "Should we add input validation before hitting the DB?",
          createdAt: now,
          resolved: false,
        },
        {
          id: "c_test_002",
          messageId: "001",
          anchorLine: 20,
          anchorEndLine: 20,
          anchorText: "Rate limiting",
          body: "5 per minute seems low — can we make it configurable?",
          createdAt: now,
          resolved: true,
        },
      ],
    }, null, 2) + "\n",
  );

  // Create a second thread (read, no unread)
  const thread2Id = "test-api-redesign";
  const thread2Dir = path.join(REVIEW_DIR, thread2Id);
  const messages2Dir = path.join(thread2Dir, "messages");
  await fs.mkdir(messages2Dir, { recursive: true });

  await fs.writeFile(
    path.join(thread2Dir, "thread.json"),
    JSON.stringify({
      id: thread2Id,
      title: "API Redesign Proposal",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      lastActivityAt: new Date(Date.now() - 3600000).toISOString(),
      readUntil: "001",
    }, null, 2) + "\n",
  );

  await fs.writeFile(
    path.join(messages2Dir, "001.json"),
    JSON.stringify({
      id: "001",
      role: "agent",
      format: "markdown",
      body: "# API Redesign\n\nProposing a move from REST to **GraphQL** for the internal API layer.\n\nBenefits:\n- Reduced over-fetching\n- Strongly typed schema\n- Better developer experience",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    }, null, 2) + "\n",
  );

  await fs.writeFile(
    path.join(thread2Dir, "comments.json"),
    JSON.stringify({ comments: [] }, null, 2) + "\n",
  );
}

/** Clean up review data */
async function cleanupReviewData() {
  try {
    await fs.rm(path.join(REPO_ROOT, ".repoview"), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** Start the server and wait for it to be ready */
function startServer() {
  return new Promise((resolve, reject) => {
    // Run the TypeScript CLI directly via tsx (no build step needed).
    const proc = spawn("npx", ["tsx", "src/cli.ts", "--repo", REPO_ROOT, "--port", String(PORT), "--no-watch"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error("Server start timeout"));
      }
    }, 10000);

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      if (text.includes("listening:") && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr.on("data", (data) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(data.toString()));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export { PORT, REPO_ROOT, REVIEW_DIR, seedReviewData, cleanupReviewData, startServer };
