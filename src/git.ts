import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { GitInfo } from "./types.js";

export interface GitExecResult {
  output: string | null;
  tooLarge: boolean;
  code: number | null;
}

export function execGit(
  repoRootReal: string,
  args: string[],
  maxBytes = 1024 * 1024,
): Promise<GitExecResult> {
  return new Promise<GitExecResult>((resolve) => {
    const child = spawn("git", args, { cwd: repoRootReal });
    let out = "";
    let size = 0;
    let killed = false;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        if (!killed) { killed = true; child.kill(); }
        return;
      }
      out += String(chunk);
    });
    child.on("close", (code) => {
      if (killed) return resolve({ output: out, tooLarge: true, code });
      resolve({ output: code === 0 ? out.trim() : null, tooLarge: false, code });
    });
    child.on("error", () => resolve({ output: null, tooLarge: false, code: -1 }));
  });
}

export function validateGitRef(ref: unknown): boolean {
  if (!ref || typeof ref !== "string") return false;
  return /^[a-zA-Z0-9_.\/\-~^]+$/.test(ref);
}

export async function getGitBranches(repoRootReal: string): Promise<string[]> {
  const { output } = await execGit(repoRootReal, ["branch", "--format=%(refname:short)"]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

export async function getGitTags(repoRootReal: string): Promise<string[]> {
  const { output } = await execGit(repoRootReal, ["tag", "-l"]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

export async function getGitDiffRaw(
  repoRootReal: string,
  base: string,
): Promise<{ raw: string; tooLarge: boolean }> {
  const maxBytes = 512 * 1024;
  const { output, tooLarge } = await execGit(repoRootReal, ["diff", base], maxBytes);
  return { raw: output || "", tooLarge };
}

export async function getGitInfo(repoRootReal: string): Promise<GitInfo> {
  const gitDir = path.join(repoRootReal, ".git");
  try {
    await fs.stat(gitDir);
  } catch {
    return { branch: null, commit: null };
  }

  const [branchResult, commitResult] = await Promise.all([
    execGit(repoRootReal, ["rev-parse", "--abbrev-ref", "HEAD"]),
    execGit(repoRootReal, ["rev-parse", "HEAD"]),
  ]);
  const branch = branchResult.output;
  const commit = commitResult.output;
  return { branch: branch && branch !== "HEAD" ? branch : branch, commit };
}
