import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Request, Response, NextFunction } from "express";

import { createSession } from "./session.js";
import { createReposRouter } from "./repo-router.js";
import { createApiRouter } from "./api.js";
import { createGistStore } from "./gists.js";
import { createGistRouter } from "./gist-router.js";
import { renderSessionPage } from "./views.js";
import { isLoopbackAddress, isLoopbackHost } from "./net.js";
import type { Session } from "./session.js";
import type { GistStore } from "./types.js";

export interface StartServerOptions {
  repoRoot: string;
  host: string;
  port: number;
  watch: boolean;
}

export interface RunningServer {
  app: express.Express;
  server: http.Server;
  session: Session;
  host: string;
  port: number;
}

interface BuildAppDeps {
  gistStore: GistStore;
  baseUrlEnv?: string;
}

/** Build the express app for a session (vendor mounts, control API, repo + gist routes). */
function buildApp(
  session: Session,
  server: http.Server,
  version: string,
  deps: BuildAppDeps,
): express.Express {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, "..");
  const require = createRequire(import.meta.url);
  const resolvePackageDir = (name: string): string =>
    path.dirname(require.resolve(`${name}/package.json`));

  const app = express();
  app.disable("x-powered-by");

  const publicDir = path.join(packageRoot, "public");
  app.use("/static", express.static(publicDir, { fallthrough: true }));
  app.use(
    "/static/vendor/github-markdown-css",
    express.static(resolvePackageDir("github-markdown-css"), { fallthrough: false }),
  );
  app.use(
    "/static/vendor/highlight.js",
    express.static(resolvePackageDir("highlight.js"), { fallthrough: false }),
  );
  app.use(
    "/static/vendor/katex",
    express.static(path.join(resolvePackageDir("katex"), "dist"), { fallthrough: false }),
  );
  app.use(
    "/static/vendor/mermaid",
    express.static(path.join(resolvePackageDir("mermaid"), "dist"), { fallthrough: false }),
  );
  app.use(
    "/static/vendor/diff2html",
    express.static(path.join(resolvePackageDir("diff2html"), "bundles", "css"), {
      fallthrough: false,
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/static/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  const onShutdown = () => {
    deps.gistStore.close();
    void session.close().finally(() => {
      server.close(() => process.exit(0));
      // Force-exit if connections linger.
      setTimeout(() => process.exit(0), 500).unref();
    });
  };
  app.use("/api", createApiRouter(session, { version, onShutdown }));
  app.use(
    "/",
    createGistRouter({ store: deps.gistStore, md: session.md, baseUrlEnv: deps.baseUrlEnv }),
  );

  // Root + legacy (non-prefixed) URLs redirect to the default repo for
  // backwards compatibility.
  app.get("/", (req, res) => {
    const def = session.getDefaultId();
    res.redirect(def ? `/r/${def}/tree/` : "/session");
  });

  // Session management page (list / open / add / remove repos). Management
  // controls only render for loopback clients (mutations are loopback-guarded).
  app.get("/session", (req, res) => {
    res.send(
      renderSessionPage({
        repos: session.listRepos(),
        version,
        canManage: isLoopbackAddress(req.socket.remoteAddress),
      }),
    );
  });

  app.use("/r", createReposRouter(session));

  const legacyRedirect = (req: Request, res: Response) => {
    const def = session.getDefaultId();
    if (!def) return res.redirect("/session");
    res.redirect(307, `/r/${def}${req.originalUrl}`);
  };
  app.get(
    [
      "/tree",
      "/tree/*",
      "/blob",
      "/blob/*",
      "/raw",
      "/raw/*",
      "/diff",
      "/events",
      "/rev",
      "/broken-links",
      "/broken-links.json",
      "/review",
      "/review/*",
    ],
    legacyRedirect,
  );

  return app;
}

export async function startServer({
  repoRoot,
  host,
  port,
  watch,
}: StartServerOptions): Promise<RunningServer> {
  const require = createRequire(import.meta.url);
  const version = (require("../package.json") as { version: string }).version;

  const session = createSession();
  await session.addRepo({ repoRoot, watch });

  const gistStore = createGistStore();
  const baseUrlEnv = process.env.REPOVIEW_BASE_URL || undefined;

  const server = http.createServer();
  const app = buildApp(session, server, version, { gistStore, baseUrlEnv });
  server.on("request", app);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  // `port: 0` picks an ephemeral port (used by tests) — stay quiet there.
  if (port !== 0) {
    const defaultId = session.getDefaultId();
    // eslint-disable-next-line no-console
    console.log(`repoview: ${path.resolve(repoRoot)}`);
    // eslint-disable-next-line no-console
    console.log(`listening: http://${host}:${port}`);
    if (defaultId) {
      // eslint-disable-next-line no-console
      console.log(`open: http://${host}:${port}/r/${defaultId}/tree/`);
    }
    if (!isLoopbackHost(host)) {
      // eslint-disable-next-line no-console
      console.warn(
        `warning: bound to ${host} — every repo added to this session is browsable ` +
          `by anyone on the network. Use --host 127.0.0.1 to keep it local.`,
      );
    }
  }

  return { app, server, session, host, port };
}
