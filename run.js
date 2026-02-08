#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

const LOG_PREFIX = "[entrypoint]";
const ROOT_DIR = process.cwd();
const SERVICE_MODES = new Set(["bot", "worker"]);
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

const runHealthcheck = async () => {
  log("Running system healthcheck...");
  await spawnCommand("npm", ["--version"], { cwd: ROOT_DIR, timeoutMs: 5000 });
  log("System healthcheck completed.");
};

const installDependencies = async () => {
  log("Installing dependencies...");
  const hasLockfile = fs.existsSync(path.join(ROOT_DIR, "package-lock.json"));
  const args = hasLockfile ? ["ci"] : ["install"];

  await spawnCommand("npm", args, { cwd: ROOT_DIR });
};

const pullLatestChanges = async () => {
  log("Pulling latest git changes...");
  await spawnCommand("git", ["pull"], { cwd: ROOT_DIR });
};

const listCommandSourceFiles = () => {
  const commandsDir = path.join(ROOT_DIR, "Bot", "src", "commands");
  if (!fs.existsSync(commandsDir)) {
    return [];
  }
  return fs
    .readdirSync(commandsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => entry.name);
};

const getMissingCommandOutputs = () => {
  const distCommandsDir = path.join(ROOT_DIR, "Bot", "dist", "commands");
  const sources = listCommandSourceFiles();
  if (!fs.existsSync(distCommandsDir)) {
    return sources.map((file) => file.replace(/\.ts$/, ".js"));
  }
  return sources
    .map((file) => file.replace(/\.ts$/, ".js"))
    .filter((output) => !fs.existsSync(path.join(distCommandsDir, output)));
};

const runBuildIfNeeded = async () => {
  const rootPackagePath = path.join(ROOT_DIR, "package.json");
  let buildArgs = ["run", "build"];
  let buildReason =
    "defaulting to root build script for Bot build (package.json not found).";

  if (fs.existsSync(rootPackagePath)) {
    const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, "utf-8"));
    const workspaces = Array.isArray(rootPackage.workspaces)
      ? rootPackage.workspaces
      : [];
    if (workspaces.includes("Bot")) {
      buildReason =
        "root package.json defines workspaces including Bot; using root build script to compile Bot and shared dependencies.";
    } else {
      buildReason =
        "root package.json has no Bot workspace entry; using root build script.";
    }
  }

  log(`Running build: npm ${buildArgs.join(" ")} (${buildReason})`);
  await spawnCommand("npm", buildArgs, { cwd: ROOT_DIR });
};

const validateBuildOutputs = () => {
  const distCommandsDir = path.join(ROOT_DIR, "Bot", "dist", "commands");
  if (!fs.existsSync(distCommandsDir)) {
    throw new Error(
      "Build did not produce Bot/dist/commands. Ensure the Bot build outputs command modules.",
    );
  }

  const entries = fs
    .readdirSync(distCommandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile());

  if (entries.length === 0) {
    throw new Error(
      "Bot/dist/commands is empty after build; expected compiled command modules.",
    );
  }

  const missingOutputs = getMissingCommandOutputs();
  if (missingOutputs.length > 0) {
    throw new Error(
      `Missing compiled command modules after build: ${missingOutputs.join(
        ", ",
      )}`,
    );
  }

  const distIndexPath = path.join(ROOT_DIR, "Bot", "dist", "index.js");
  const distIndexAltPath = path.join(ROOT_DIR, "Bot", "dist", "src", "index.js");
  if (!fs.existsSync(distIndexPath) && !fs.existsSync(distIndexAltPath)) {
    throw new Error(
      "Build did not produce Bot/dist/index.js (or Bot/dist/src/index.js).",
    );
  }
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
    logError("SERVICE_MODE must be one of: bot, worker.");
    process.exit(1);
  }
  return mode;
};

const main = async () => {
  loadEnv();
  const serviceMode = validateServiceMode();
  await runHealthcheck();
  await installDependencies();
  await pullLatestChanges();
  await runBuildIfNeeded();
  validateBuildOutputs();
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
