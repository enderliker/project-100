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
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function startGitAutoPull(options: GitAutoPullOptions): NodeJS.Timeout | null {
  if (autoPullRunning) {
    console.warn("[git] autopull already running, skipping start");
    return null;
  }
  autoPullRunning = true;
  const { intervalMs, remote, branch, repoPath } = options;
  const repoRoot = path.resolve(process.cwd(), repoPath);
  const gitDir = path.join(repoRoot, ".git");

  let loggedMissing = false;
  let loggedDetected = false;
  let loggedUpToDate = false;

  const runOnce = async (): Promise<void> => {
    const hasGit = await pathExists(gitDir);
    if (!hasGit) {
      if (!loggedMissing) {
        console.warn("[git] .git not found, autopull disabled");
        loggedMissing = true;
      }
      return;
    }

    if (!loggedDetected) {
      console.info("[git] repo detected");
      loggedDetected = true;
    }

    try {
      console.info(`[git] fetching ${remote}/${branch}`);
      await runGit(["fetch", remote], repoRoot);

      const revList = await runGit(
        ["rev-list", "--left-right", "--count", `HEAD...${remote}/${branch}`],
        repoRoot
      );
      const [aheadRaw, behindRaw] = revList.split(/\s+/);
      const aheadParsed = Number.parseInt(aheadRaw ?? "0", 10);
      const behindParsed = Number.parseInt(behindRaw ?? "0", 10);
      const ahead = Number.isFinite(aheadParsed) ? aheadParsed : 0;
      const behind = Number.isFinite(behindParsed) ? behindParsed : 0;

      if (behind === 0 && ahead === 0) {
        if (!loggedUpToDate) {
          console.info("[git] repo up to date");
          loggedUpToDate = true;
        }
        return;
      }

      loggedUpToDate = false;
      if (behind === 0) {
        return;
      }
      const status = await runGit(["status", "--porcelain"], repoRoot);
      const workingTreeDirty = status.length > 0;
      let stashCreated = false;
      if (workingTreeDirty) {
        console.warn("[git] working tree dirty, stashing changes");
        const timestamp = new Date().toISOString();
        await runGit(["stash", "push", "-u", "-m", `autopull:${timestamp}`], repoRoot);
        stashCreated = true;
      }

      try {
        await runGit(["pull", "--ff-only", remote, branch], repoRoot);
        console.info("[git] fast-forward pull applied");
      } finally {
        if (stashCreated) {
          try {
            await runGit(["stash", "pop"], repoRoot);
          } catch (error) {
            console.warn("[git] stash apply conflict, manual resolution required");
          }
        }
      }
    } catch (error) {
      console.warn(`[git] autopull failed: ${formatErrorMessage(error)}`);
    }
  };

  void runOnce();
  return setInterval(() => {
    void runOnce();
  }, intervalMs);
}

let autoPullRunning = false;
