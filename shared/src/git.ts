import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface GitAutoPullOptions {
  repoPath: string;
  intervalMs: number;
  remote: string;
  branch: string;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    const gitPath = path.join(current, ".git");
    if (await pathExists(gitPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function startGitAutoPull(options: GitAutoPullOptions): NodeJS.Timeout | null {
  const { intervalMs, remote, branch, repoPath } = options;

  let gitRoot: string | null = null;
  let loggedMissing = false;

  const runOnce = async (): Promise<void> => {
    if (!gitRoot) {
      gitRoot = await findGitRoot(repoPath);
      if (!gitRoot) {
        if (!loggedMissing) {
          console.warn("[git] .git not found, skipping pull");
          loggedMissing = true;
        }
        return;
      }
    }

    try {
      await runGit(["fetch", remote], gitRoot);
      const localHead = await runGit(["rev-parse", "HEAD"], gitRoot);
      const remoteHead = await runGit(["rev-parse", `${remote}/${branch}`], gitRoot);
      if (localHead === remoteHead) {
        console.info("[git] repository up to date");
        return;
      }

      const status = await runGit(["status", "--porcelain"], gitRoot);
      if (status.length > 0) {
        console.warn("[git] local changes detected, skipping pull");
        return;
      }

      await runGit(["pull", "--ff-only", remote, branch], gitRoot);
      console.info("[git] pulled latest changes");
    } catch (error) {
      console.warn(`[git] autopull failed: ${formatErrorMessage(error)}`);
    }
  };

  void runOnce();
  return setInterval(() => {
    void runOnce();
  }, intervalMs);
}
