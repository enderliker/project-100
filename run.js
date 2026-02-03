#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

const LOG_PREFIX = "[entrypoint]";
const ROOT_DIR = process.cwd();
const SERVICE_MODES = new Set(["bot", "worker", "worker2"]);
const SENSITIVE_ENV = ["DISCORD_TOKEN", "REDIS_PASSWORD", "PG_PASSWORD"];

const log = (message) => {
  console.log(`${LOG_PREFIX} ${message}`);
};

const logError = (message) => {
  console.error(`${LOG_PREFIX} ${message}`);
};

const sanitizeErrorStack = (stack) => {
  let sanitized = stack;
  for (const name of SENSITIVE_ENV) {
    const value = process.env[name];
    if (value) {
      sanitized = sanitized.split(value).join("***");
    }
  }
  return sanitized;
};

const logErrorStack = (error) => {
  const stack =
    error instanceof Error ? error.stack || error.message : String(error);
  console.error(`${LOG_PREFIX} ${sanitizeErrorStack(stack)}`);
};

const loadEnv = () => {
  const candidates = [
    path.join("/home/container", ".env"),
    path.join(ROOT_DIR, ".env"),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      log(`Loaded environment from ${envPath}`);
      return;
    }
  }

  log("No .env file found; relying on existing environment variables.");
};

const spawnCommand = (command, args, { cwd, timeoutMs } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    let timeoutId;
    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.on("error", (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    child.on("exit", (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });

const spawnCapture = (command, args, { cwd, timeoutMs } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timeoutId;

    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    child.on("exit", (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });

const startGitAutoPull = () => {
  const repoPath = process.env.GIT_REPO_PATH || ".";
  const remote = process.env.GIT_REMOTE || "origin";
  const branch = process.env.GIT_BRANCH || "main";
  const intervalMs = Number.parseInt(
    process.env.GIT_AUTOPULL_INTERVAL_MS || "30000",
    10,
  );
  const normalizedInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30000;

  const repoRoot = path.resolve(process.cwd(), repoPath);
  const gitDir = path.join(repoRoot, ".git");
  let loggedMissing = false;
  let loggedDetected = false;
  let loggedUpToDate = false;

  const runOnce = async () => {
    if (!fs.existsSync(gitDir)) {
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
      await spawnCommand("git", ["fetch", remote], {
        cwd: repoRoot,
        timeoutMs: 15000,
      });

      const revList = await spawnCapture(
        "git",
        ["rev-list", "--left-right", "--count", `HEAD...${remote}/${branch}`],
        { cwd: repoRoot, timeoutMs: 5000 },
      );
      const [aheadRaw, behindRaw] = revList.stdout.trim().split(/\s+/);
      const aheadParsed = Number.parseInt(aheadRaw || "0", 10);
      const behindParsed = Number.parseInt(behindRaw || "0", 10);
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
      const status = await spawnCapture("git", ["status", "--porcelain"], {
        cwd: repoRoot,
        timeoutMs: 5000,
      });
      if (status.stdout.trim().length > 0) {
        console.warn("[git] autopull skipped (local changes)");
        return;
      }

      await spawnCommand("git", ["pull", "--ff-only", remote, branch], {
        cwd: repoRoot,
        timeoutMs: 15000,
      });
      console.info("[git] fast-forward pull applied");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[git] autopull failed: ${message}`);
    }
  };

  void runOnce();
  return setInterval(() => {
    void runOnce();
  }, normalizedInterval);
};

const runHealthcheck = async () => {
  log("Running system healthcheck...");
  await spawnCommand("npm", ["--version"], { cwd: ROOT_DIR, timeoutMs: 5000 });
  log("System healthcheck completed.");
};

const installDependencies = async () => {
  log("Installing dependencies...");
  const hasLockfile = fs.existsSync(path.join(ROOT_DIR, "package-lock.json"));
  if (hasLockfile) {
    await spawnCommand("npm", ["ci", "--omit=dev"], { cwd: ROOT_DIR });
    return;
  }
  await spawnCommand("npm", ["install", "--omit=dev"], { cwd: ROOT_DIR });
};

const getLatestMtime = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  let latest = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, getLatestMtime(fullPath));
      continue;
    }
    const stat = fs.statSync(fullPath);
    latest = Math.max(latest, stat.mtimeMs);
  }
  return latest;
};

const needsBuild = () => {
  const packages = ["shared", "Bot", "worker", "worker2"];
  for (const pkg of packages) {
    const srcDir = path.join(ROOT_DIR, pkg, "src");
    const distDir = path.join(ROOT_DIR, pkg, "dist");
    if (!fs.existsSync(distDir)) {
      return true;
    }
    const latestSrc = getLatestMtime(srcDir);
    const latestDist = getLatestMtime(distDir);
    if (latestDist === 0 || latestSrc > latestDist) {
      return true;
    }
  }
  return false;
};

const runBuildIfNeeded = async () => {
  if (!needsBuild()) {
    log("Build output is up to date; skipping build.");
    return;
  }
  log("Building TypeScript outputs...");
  await spawnCommand("npm", ["run", "build"], { cwd: ROOT_DIR });
};

const resolveServiceEntry = (serviceDir) => {
  const candidates = [
    path.join(ROOT_DIR, serviceDir, "dist", "src", "index.js"),
    path.join(ROOT_DIR, serviceDir, "dist", "index.js"),
  ];
  for (const entry of candidates) {
    if (fs.existsSync(entry)) {
      return entry;
    }
  }
  throw new Error(
    `Compiled entrypoint not found for ${serviceDir}. Expected one of: ${candidates.join(
      ", ",
    )}`,
  );
};

const runService = async (serviceMode) => {
  const serviceDir = serviceMode === "bot" ? "Bot" : serviceMode;
  const entry = resolveServiceEntry(serviceDir);
  log(`Starting ${serviceMode} service...`);
  await spawnCommand("node", [entry], { cwd: ROOT_DIR });
};

const validateServiceMode = () => {
  const mode = process.env.SERVICE_MODE;
  if (!SERVICE_MODES.has(mode)) {
    logError("SERVICE_MODE must be one of: bot, worker, worker2.");
    process.exit(1);
  }
  return mode;
};

const main = async () => {
  loadEnv();
  const serviceMode = validateServiceMode();
  startGitAutoPull();
  await runHealthcheck();
  await installDependencies();
  await runBuildIfNeeded();
  await runService(serviceMode);
};

process.on("unhandledRejection", (error) => {
  logError(error instanceof Error ? error.message : String(error));
  logErrorStack(error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logError(error.message);
  logErrorStack(error);
  process.exit(1);
});

main().catch((error) => {
  logError(error.message);
  logErrorStack(error);
  process.exit(1);
});
