import type { FSWatcher } from "chokidar";

export interface GitInfo {
  branch: string | null;
  commit: string | null;
}

/** Lightweight description of a repo registered in a session. */
export interface RepoSummary {
  id: string;
  name: string;
  path: string;
  branch: string | null;
}

export interface IgnoreOptions {
  isDir?: boolean;
}

export interface IgnoreMatcher {
  ignores(relPathPosix: string, options?: IgnoreOptions): boolean;
}

/** Environment passed into the markdown renderer per render call. */
export interface MarkdownEnv {
  baseDirPosix?: string;
  emitLineMap?: boolean;
  /** URL prefix for the current repo, e.g. "/r/myrepo". Empty = legacy/root. */
  repoBase?: string;
  [key: string]: unknown;
}

export interface MarkdownRenderer {
  render(markdown: string, env?: MarkdownEnv): string;
  renderCodeBlock(text: string, options?: { languageHint?: string }): string;
}

export type BrokenLinkKind = "url" | "blob" | "tree" | "raw";

export interface BrokenLink {
  source: string;
  url: string;
  kind: BrokenLinkKind | null;
  reason: string | null;
  target?: string;
}

export interface ScanResult {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  filesScanned: number;
  urlsChecked: number;
  broken: BrokenLink[];
}

export interface ScanState {
  status: "idle" | "running";
  lastResult: ScanResult | null;
  lastError: string | null;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
}

export interface ScanOptions {
  maxMarkdownFiles?: number;
  maxBytesPerFile?: number;
  concurrency?: number;
}

export interface LinkScanner {
  scanOnce(options?: ScanOptions): Promise<ScanResult>;
  triggerScan(options?: ScanOptions): Promise<ScanState>;
  getState(): ScanState;
}

/** Server-Sent-Events response sink (the subset of express.Response we use). */
export interface SseClient {
  write(chunk: string): boolean;
  end(): void;
  on(event: "close", listener: () => void): void;
}

export interface ReloadHub {
  add(res: SseClient): void;
  broadcastReload(): void;
  getRevision(): number;
  broadcastPing(): void;
  close(): void;
}

/** All per-repo runtime state, bundled so routes can be served per repo. */
export interface RepoContext {
  id: string;
  repoRootReal: string;
  repoName: string;
  gitInfo: GitInfo;
  reloadHub: ReloadHub;
  reviewDir: string;
  md: MarkdownRenderer;
  ignoreMatcher: IgnoreMatcher;
  isIgnored: (relPosix: string, options?: IgnoreOptions) => boolean;
  linkScanner: LinkScanner;
  watcher: FSWatcher | null;
  close(): Promise<void>;
}
