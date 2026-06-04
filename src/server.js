import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { createMarkdownRenderer } from "./markdown.js";
import { createRepoContext } from "./repo-context.js";
import { createRepoRouter } from "./repo-router.js";

export async function startServer({ repoRoot, host, port, watch }) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, "..");
  const require = createRequire(import.meta.url);

  const resolvePackageDir = (name) => {
    const pkgJson = require.resolve(`${name}/package.json`);
    return path.dirname(pkgJson);
  };

  const md = createMarkdownRenderer();
  const ctx = await createRepoContext({ repoRoot, md, watch });

  const app = express();
  app.disable("x-powered-by");

  const publicDir = path.join(packageRoot, "public");
  app.use("/static", express.static(publicDir, { fallthrough: true }));
  app.use(
    "/static/vendor/github-markdown-css",
    express.static(resolvePackageDir("github-markdown-css"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/highlight.js",
    express.static(resolvePackageDir("highlight.js"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/katex",
    express.static(path.join(resolvePackageDir("katex"), "dist"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/mermaid",
    express.static(path.join(resolvePackageDir("mermaid"), "dist"), {
      fallthrough: false,
    }),
  );
  app.use(
    "/static/vendor/diff2html",
    express.static(path.join(resolvePackageDir("diff2html"), "bundles", "css"), {
      fallthrough: false,
    }),
  );

  app.use((req, res, next) => {
    if (!req.path.startsWith("/static/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/", (req, res) => res.redirect("/tree/"));

  app.use("/", createRepoRouter(ctx));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, host, resolve));

  // eslint-disable-next-line no-console
  console.log(`repoview: ${ctx.repoRootReal}`);
  // eslint-disable-next-line no-console
  console.log(`listening: http://${host}:${port}`);

  return { app, server, ctx };
}
