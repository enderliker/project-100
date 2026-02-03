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

let autoPullPromise: Promise<GitAutopullResult> | null = null;
let autoPullResult: GitAutopullResult | null = null;

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

async function hasTrackedChanges(repoRoot: string): Promise<boolean> {
  const status = await runGit(["status", "--porcelain", "--untracked-files=no"], repoRoot);
  return status.length > 0;
}

async function runAutopull(options: GitAutopullOptions): Promise<GitAutopullResult> {
  const repoRoot = path.resolve(process.cwd(), options.repoPath);
  const gitDir = path.join(repoRoot, ".git");

  const hasGit = await pathExists(gitDir);
  if (!hasGit) {
    logger.warn("no repo detected, skipping");
    return { status: "no_repo" };
  }

  logger.info("repo detected");
  try {
    logger.info(`fetching ${options.remote}/${options.branch}`);
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
      logger.info("repo up to date");
      return { status: "up_to_date" };
    }

    if (behind === 0) {
      logger.info("repo up to date");
      return { status: "up_to_date" };
    }

    if (await hasTrackedChanges(repoRoot)) {
      logger.warn("local changes detected, skipping fast-forward");
      return { status: "local_changes" };
    }

    await runGit(["merge", "--ff-only", `${options.remote}/${options.branch}`], repoRoot);
    logger.info("fast-forward applied");
    return { status: "fast_forward" };
  } catch {
    return { status: "failed" };
  }
}

export async function runGitAutopullOnceOnStartup(
  options: GitAutopullOptions
): Promise<GitAutopullResult> {
  if (autoPullResult) {
    logger.warn("autopull already executed, skipping");
    return autoPullResult;
  }

  if (!autoPullPromise) {
    autoPullPromise = (async () => {
      const result = await runAutopull(options);
      logger.info("autopull executed on startup");
      return result;
    })();
  }

  try {
    autoPullResult = await autoPullPromise;
    return autoPullResult;
  } finally {
    autoPullPromise = null;
  }
}
