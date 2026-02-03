import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { createLogger } from "./logger";

const execFileAsync = promisify(execFile);
const logger = createLogger("git");

export interface GitAutopullOptions {
  repoPath: string;
  remote: string;
  branch: string;
}

export type GitAutopullStatus =
  | "no_repo"
  | "up_to_date"
  | "fast_forward"
  | "local_changes"
  | "skipped"
  | "failed";

export interface GitAutopullResult {
  status: GitAutopullStatus;
}

let updatePromise: Promise<GitAutopullResult> | null = null;
let updateResult: GitAutopullResult | null = null;

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

async function getLocalStatus(repoRoot: string): Promise<string> {
  return runGit(["status", "--porcelain"], repoRoot);
}

async function runUpdate(options: GitAutopullOptions): Promise<GitAutopullResult> {
  const repoRoot = path.resolve(process.cwd(), options.repoPath);
  const gitDir = path.join(repoRoot, ".git");

  const hasGit = await pathExists(gitDir);
  if (!hasGit) {
    logger.error("error: repo not detected");
    return { status: "no_repo" };
  }

  logger.info("repo detected");
  try {
    logger.info(`fetch ${options.remote}/${options.branch}`);
    await runGit(["fetch", options.remote, options.branch], repoRoot);

    const revList = await runGit(
      ["rev-list", "--left-right", "--count", `HEAD...${options.remote}/${options.branch}`],
      repoRoot
    );
    const [aheadRaw, behindRaw] = revList.split(/\s+/);
    const aheadParsed = Number.parseInt(aheadRaw ?? "0", 10);
    const behindParsed = Number.parseInt(behindRaw ?? "0", 10);
    const ahead = Number.isFinite(aheadParsed) ? aheadParsed : 0;
    const behind = Number.isFinite(behindParsed) ? behindParsed : 0;

    if (behind === 0 && ahead === 0) {
      logger.info("up to date");
      return { status: "up_to_date" };
    }

    if (behind === 0) {
      logger.info("up to date");
      return { status: "up_to_date" };
    }
    const status = await getLocalStatus(repoRoot);
    const hasLocalChanges = status.length > 0;
    let stashCreated = false;

    if (hasLocalChanges) {
      logger.warn("local changes detected (stashing before update)");
      await runGit(
        ["stash", "push", "--include-untracked", "--message", "autoupdate"],
        repoRoot
      );
      stashCreated = true;
    }

    try {
      await runGit(["merge", "--ff-only", `${options.remote}/${options.branch}`], repoRoot);
    } catch (error) {
      if (stashCreated) {
        try {
          await runGit(["stash", "apply"], repoRoot);
        } catch {
          logger.error("error: stash apply failed after update failure");
        }
      }
      const message = error instanceof Error ? error.message : "update failed";
      logger.error(`error: ${message}`);
      return { status: "failed" };
    }

    logger.info("update applied");

    if (stashCreated) {
      try {
        await runGit(["stash", "apply"], repoRoot);
        await runGit(["stash", "drop"], repoRoot);
      } catch {
        // Keep running on the updated tree if stash apply fails.
        logger.error("error: stash apply failed; resolve manually");
      }
      return { status: "local_changes" };
    }

    return { status: "fast_forward" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    logger.error(`error: ${message}`);
    return { status: "failed" };
  }
}

export async function runGitUpdateOnce(
  options: GitAutopullOptions
): Promise<GitAutopullResult> {
  if (updateResult) {
    logger.warn("update already executed, skipping");
    return updateResult;
  }

  if (!updatePromise) {
    updatePromise = (async () => runUpdate(options))();
  }

  try {
    updateResult = await updatePromise;
    return updateResult;
  } finally {
    updatePromise = null;
  }
}
