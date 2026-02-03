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
  if (autoPullExecuted) {
    console.warn("[git] autopull already executed, skipping");
    return null;
  }
  autoPullExecuted = true;
  const { remote, branch, repoPath } = options;
  const repoRoot = path.resolve(process.cwd(), repoPath);
  const gitDir = path.join(repoRoot, ".git");

  const runOnce = async (): Promise<void> => {
    const hasGit = await pathExists(gitDir);
    if (!hasGit) {
      console.warn("[git] .git not found, autopull disabled");
      return;
    }

    console.info("[git] repo detected");

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
        console.info("[git] repo up to date");
        return;
      }

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

  void (async () => {
    await runOnce();
    console.info("[git] autopull executed on startup");
  })();
  return null;
}

let autoPullExecuted = false;
