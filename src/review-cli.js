import fs from "node:fs/promises";
import path from "node:path";

function generateThreadId(title) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${date}-${slug}`;
}

function getNextMessageId(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const n = parseInt(id, 10);
    if (n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}

export async function reviewNew({ title, reviewDir }) {
  if (!title) {
    process.stderr.write("Error: --title is required\n");
    process.exit(1);
  }

  const id = generateThreadId(title);
  const threadDir = path.join(reviewDir, id);
  const messagesDir = path.join(threadDir, "messages");

  await fs.mkdir(messagesDir, { recursive: true });

  const now = new Date().toISOString();
  const thread = {
    id,
    title,
    createdAt: now,
    lastActivityAt: now,
    readUntil: null,
  };

  await fs.writeFile(path.join(threadDir, "thread.json"), JSON.stringify(thread, null, 2) + "\n");
  await fs.writeFile(path.join(threadDir, "comments.json"), JSON.stringify({ comments: [] }, null, 2) + "\n");

  process.stdout.write(id + "\n");
}

export async function reviewPost({ threadId, role, body, file, reviewDir }) {
  if (!threadId) {
    process.stderr.write("Error: thread-id is required\n");
    process.exit(1);
  }

  const threadDir = path.join(reviewDir, threadId);
  const messagesDir = path.join(threadDir, "messages");
  const threadFile = path.join(threadDir, "thread.json");

  try {
    await fs.stat(threadFile);
  } catch {
    process.stderr.write(`Error: thread "${threadId}" not found\n`);
    process.exit(1);
  }

  let messageBody = body || "";
  if (file) {
    messageBody = await fs.readFile(file, "utf8");
  } else if (!body) {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    messageBody = Buffer.concat(chunks).toString("utf8");
  }

  if (!messageBody.trim()) {
    process.stderr.write("Error: message body is empty\n");
    process.exit(1);
  }

  // Find next message ID
  let entries = [];
  try {
    entries = await fs.readdir(messagesDir);
  } catch {
    await fs.mkdir(messagesDir, { recursive: true });
  }
  const existingIds = entries.filter((e) => e.endsWith(".json")).map((e) => e.replace(".json", ""));
  const nextId = getNextMessageId(existingIds);

  const now = new Date().toISOString();
  const messageRole = role || "agent";
  const format = messageRole === "agent" ? "markdown" : "text";

  const message = {
    id: nextId,
    role: messageRole,
    format,
    body: messageBody,
    createdAt: now,
  };

  await fs.writeFile(path.join(messagesDir, `${nextId}.json`), JSON.stringify(message, null, 2) + "\n");

  // Update lastActivityAt in thread.json
  const thread = JSON.parse(await fs.readFile(threadFile, "utf8"));
  thread.lastActivityAt = now;
  await fs.writeFile(threadFile, JSON.stringify(thread, null, 2) + "\n");

  process.stdout.write(nextId + "\n");
}

export async function reviewRead({ threadId, reviewDir }) {
  if (!threadId) {
    process.stderr.write("Error: thread-id is required\n");
    process.exit(1);
  }

  const threadDir = path.join(reviewDir, threadId);
  const threadFile = path.join(threadDir, "thread.json");

  try {
    await fs.stat(threadFile);
  } catch {
    process.stderr.write(`Error: thread "${threadId}" not found\n`);
    process.exit(1);
  }

  const thread = JSON.parse(await fs.readFile(threadFile, "utf8"));

  const messagesDir = path.join(threadDir, "messages");
  let messageFiles = [];
  try {
    messageFiles = (await fs.readdir(messagesDir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // no messages yet
  }

  const messages = [];
  for (const f of messageFiles) {
    const msg = JSON.parse(await fs.readFile(path.join(messagesDir, f), "utf8"));
    messages.push(msg);
  }

  let comments = { comments: [] };
  try {
    comments = JSON.parse(await fs.readFile(path.join(threadDir, "comments.json"), "utf8"));
  } catch {
    // no comments file
  }

  const result = { thread, messages, comments: comments.comments };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

export async function reviewList({ reviewDir }) {
  let entries = [];
  try {
    entries = await fs.readdir(reviewDir, { withFileTypes: true });
  } catch {
    process.stdout.write("[]\n");
    return;
  }

  const threads = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const threadFile = path.join(reviewDir, entry.name, "thread.json");
    try {
      const thread = JSON.parse(await fs.readFile(threadFile, "utf8"));
      // Count messages
      let messageCount = 0;
      try {
        const msgs = await fs.readdir(path.join(reviewDir, entry.name, "messages"));
        messageCount = msgs.filter((f) => f.endsWith(".json")).length;
      } catch {
        // no messages
      }
      threads.push({ ...thread, messageCount });
    } catch {
      // skip dirs without thread.json
    }
  }

  // Sort by lastActivityAt, newest first
  threads.sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));

  process.stdout.write(JSON.stringify(threads, null, 2) + "\n");
}

export async function handleReviewCommand(argv, repoRoot) {
  const subcommand = argv[0];
  const args = argv.slice(1);

  // Parse --review-dir flag
  let reviewDir = path.join(repoRoot, ".repoview", "reviews");
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--review-dir") {
      reviewDir = args[++i];
    } else {
      rest.push(args[i]);
    }
  }

  // Parse subcommand-specific flags
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i];
    if (v === "--title") flags.title = rest[++i];
    else if (v === "--role") flags.role = rest[++i];
    else if (v === "--body") flags.body = rest[++i];
    else if (v === "--file") flags.file = rest[++i];
    else positional.push(v);
  }

  switch (subcommand) {
    case "new":
      await reviewNew({ title: flags.title, reviewDir });
      break;
    case "post":
      await reviewPost({
        threadId: positional[0],
        role: flags.role,
        body: flags.body,
        file: flags.file,
        reviewDir,
      });
      break;
    case "read":
      await reviewRead({ threadId: positional[0], reviewDir });
      break;
    case "list":
      await reviewList({ reviewDir });
      break;
    default:
      process.stderr.write(`Unknown review subcommand: ${subcommand}\n`);
      process.stderr.write("Usage: repoview review <new|post|read|list> [options]\n");
      process.exit(1);
  }
}
