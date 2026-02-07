import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Client, GatewayIntentBits, Options, REST } from "discord.js";
import {
  createJob,
  createPostgresPool,
  createRedisClient,
  checkPostgresHealth,
  checkRedisHealth,
  enqueueJob,
  getLoadMetrics,
  rateLimit,
  registerGracefulShutdown,
  runGitUpdateOnce,
  startHealthServer,
  createLogger,
  ServiceStateTracker,
  RemoteServiceCheckResult,
  checkRemoteService,
  envParsers,
  loadConfig,
  registerProcessHandlers
} from "@project/shared";
import { execFileSync } from "child_process";
import { URL } from "url";
import type { Pool } from "pg";
import type { CommandExecutionContext } from "./commands/types";
import { handleInteraction } from "./command-handler/execute";
import {
  registerCommandDefinitions,
  reloadDiscordCommands
} from "./command-handler/registry";

const SENSITIVE_ENV = ["DISCORD_TOKEN", "REDIS_PASSWORD", "PG_PASSWORD"];
const startupLogger = createLogger("startup");
const redisLogger = createLogger("redis");
const httpLogger = createLogger("http");
const healthLogger = createLogger("health");
const discordLogger = createLogger("discord");

const POSTGRES_REQUIRED_ENV = [
  "PG_HOST",
  "PG_PORT",
  "PG_USER",
  "PG_PASSWORD",
  "PG_DATABASE",
  "PG_POOL_MAX",
  "PG_IDLE_TIMEOUT_MS",
  "PG_SSL_REJECT_UNAUTHORIZED",
  "PG_QUERY_BASE_DELAY_MS",
  "PG_QUERY_MAX_DELAY_MS"
];

function sanitizeErrorStack(stack: string): string {
  let sanitized = stack;
  for (const name of SENSITIVE_ENV) {
    const value = process.env[name];
    if (value) {
      sanitized = sanitized.split(value).join("***");
    }
  }
  return sanitized;
}

function exitWithStartupError(error: unknown, context: string): void {
  const stack =
    error instanceof Error ? error.stack ?? error.message : String(error);
  startupLogger.fatal(`event=startup_failed context="${context}"`);
  startupLogger.fatal(`stack="${sanitizeErrorStack(stack)}"`);
  process.exit(1);
}

function exitWithConfigError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  startupLogger.fatal(`event=config_invalid message="${message}"`);
  process.exit(1);
}

function runBuildForUpdatedRepo(repoPath: string): void {
  startupLogger.info("event=repo_build_start reason=git_update");
  try {
    execFileSync("npm", ["run", "build"], {
      cwd: repoPath,
      stdio: "inherit"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`repo build failed after git update: ${message}`);
  }
  startupLogger.info("event=repo_build_complete reason=git_update");
}


function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function getRedisStartupErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown Redis startup error";
}

function logRedisStartupFailure(error: unknown): void {
  const message = getRedisStartupErrorMessage(error);
  if (message.includes("WRONGPASS")) {
    redisLogger.error(
      "authentication failed (WRONGPASS). Check REDIS_USERNAME/REDIS_PASSWORD."
    );
    return;
  }
  redisLogger.error(`startup failed: ${message}`);
}

function parsePayload(body: string): {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
} {
  const parsed = JSON.parse(body) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Body must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== "string" || record.type.length === 0) {
    throw new Error("type must be a non-empty string");
  }
  if (typeof record.payload !== "object" || record.payload === null) {
    throw new Error("payload must be an object");
  }
  if (
    record.idempotencyKey !== undefined &&
    (typeof record.idempotencyKey !== "string" || record.idempotencyKey.length === 0)
  ) {
    throw new Error("idempotencyKey must be a non-empty string when provided");
  }
  return {
    type: record.type,
    payload: record.payload as Record<string, unknown>,
    idempotencyKey: record.idempotencyKey as string | undefined
  };
}

function loadPackageVersion(): string | null {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function loadGitVersion(repoPath: string): string | null {
  try {
    const output = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const version = output.toString("utf-8").trim();
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

function loadVersionInfo(repoPath: string): string {
  const gitVersion = loadGitVersion(repoPath);
  if (gitVersion) {
    return gitVersion;
  }
  const pkgVersion = loadPackageVersion();
  if (pkgVersion) {
    return pkgVersion;
  }
  return "0.0.0";
}

function isPostgresConfigured(): boolean {
  return POSTGRES_REQUIRED_ENV.some((name) => Boolean(process.env[name]));
}

function ensurePostgresConfigValid(): void {
  const missing = POSTGRES_REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Postgres config incomplete: missing ${missing.join(", ")}`);
  }
}

function summarizeRemoteCheck(result: RemoteServiceCheckResult): string {
  if (result.status === "up") {
    return "ok";
  }
  return result.reason ?? "down";
}

function deriveBotState(
  serviceState: ServiceStateTracker,
  checks: Record<string, { ok: boolean; reason?: string }>
): void {
  const redisOk = checks.redis?.ok ?? false;
  const postgresOk = checks.postgres?.ok ?? true;
  const workerOk = checks.worker?.ok ?? false;

  if (!redisOk) {
    serviceState.setState("ERROR", "redis_unreachable");
    return;
  }

  if (!postgresOk) {
    serviceState.setState("ERROR", "postgres_unreachable");
    return;
  }

  if (!workerOk) {
    const detail = `worker=${workerOk ? "up" : "down"}`;
    serviceState.setState("DEGRADED", `worker_unreachable ${detail}`);
    return;
  }

  serviceState.setState("READY");
}

async function main(): Promise<void> {
  startupLogger.info("event=env_loaded");
  registerProcessHandlers({ logger: startupLogger, sensitiveEnv: SENSITIVE_ENV });

  let port: number;
  let rateLimitMax: number;
  let rateWindow: number;
  let queueName: string;
  let maxLoad: number | null;
  let healthPort: number;
  let gitRepoPath: string;
  let gitRemote: string;
  let gitBranch: string;
  let discordToken: string;
  let discordAppId: string;
  let workerHealthUrl: string;
  let statusCheckTimeoutMs: number;
  let statusCheckRetries: number;
  let healthCheckTimeoutMs: number;
  let extraCheckUrls: string[];
  let postgresPool: Pool | null = null;

  try {
    const config = loadConfig({
      port: {
        name: "HTTP_PORT",
        parse: envParsers.positiveNumber(),
        required: false,
        default: 3028
      },
      rateLimitMax: {
        name: "BOT_RATE_LIMIT",
        parse: envParsers.positiveNumber(),
        required: true
      },
      rateWindow: {
        name: "BOT_RATE_WINDOW_SEC",
        parse: envParsers.positiveNumber(),
        required: true
      },
      queueName: {
        name: "BOT_QUEUE_NAME",
        parse: envParsers.nonEmptyString(),
        required: true
      },
      maxLoad: {
        name: "BOT_MAX_LOAD1",
        parse: envParsers.optionalPositiveNumber(),
        required: false,
        default: null
      },
      healthPort: {
        name: "HEALTH_PORT",
        parse: envParsers.positiveNumber(),
        required: false,
        default: 3001
      },
      extraCheckUrls: {
        name: "BOT_CHECK_URLS",
        parse: envParsers.urlList(),
        required: true
      },
      healthCheckIntervalMs: {
        name: "HEALTH_CHECK_INTERVAL_MS",
        parse: envParsers.positiveNumber(),
        required: true
      },
      healthCheckTimeoutMs: {
        name: "HEALTH_CHECK_TIMEOUT_MS",
        parse: envParsers.positiveNumber(),
        required: true
      },
      gitRepoPath: {
        name: "GIT_REPO_PATH",
        parse: envParsers.nonEmptyString(),
        required: true
      },
      gitRemote: {
        name: "GIT_REMOTE",
        parse: envParsers.nonEmptyString(),
        required: true
      },
      gitBranch: {
        name: "GIT_BRANCH",
        parse: envParsers.nonEmptyString(),
        required: true
      },
      discordToken: {
        name: "DISCORD_TOKEN",
        parse: envParsers.nonEmptyString(),
        required: true
      },
      discordAppId: {
        name: "DISCORD_APP_ID",
        parse: envParsers.numericString(),
        required: true
      },
      workerBaseUrl: {
        name: "WORKER1_URL",
        parse: envParsers.url(),
        required: true
      },
      statusCheckTimeoutMs: {
        name: "STATUS_CHECK_TIMEOUT_MS",
        parse: envParsers.optionalPositiveNumber(),
        required: false,
        default: null
      },
      statusCheckRetries: {
        name: "STATUS_CHECK_RETRIES",
        parse: envParsers.optionalPositiveNumber(),
        required: false,
        default: null
      }
    });

    port = config.port;
    rateLimitMax = config.rateLimitMax;
    rateWindow = config.rateWindow;
    queueName = config.queueName;
    maxLoad = config.maxLoad;
    healthPort = config.healthPort;
    extraCheckUrls = config.extraCheckUrls;
    healthCheckTimeoutMs = config.healthCheckTimeoutMs;
    gitRepoPath = config.gitRepoPath;
    gitRemote = config.gitRemote;
    gitBranch = config.gitBranch;
    discordToken = config.discordToken;
    discordAppId = config.discordAppId;
    const workerBaseUrl = config.workerBaseUrl;
    workerHealthUrl = new URL("/healthz", workerBaseUrl).toString();
    statusCheckTimeoutMs = config.statusCheckTimeoutMs ?? 1500;
    statusCheckRetries = config.statusCheckRetries ?? 1;
    if (isPostgresConfigured()) {
      ensurePostgresConfigValid();
    }
  } catch (error) {
    exitWithConfigError(error);
  }

  startupLogger.info("event=config_validated");

  const gitUpdateResult = await runGitUpdateOnce({
    repoPath: gitRepoPath,
    remote: gitRemote,
    branch: gitBranch
  });
  if (
    gitUpdateResult.status === "fast_forward" ||
    gitUpdateResult.status === "local_changes"
  ) {
    runBuildForUpdatedRepo(gitRepoPath);
  }

  const redis = createRedisClient();
  if (isPostgresConfigured()) {
    postgresPool = createPostgresPool();
  }
  try {
    redisLogger.info("event=redis_connecting");
    await redis.connect();
    await redis.ping();
    redisLogger.info("event=redis_ready detail=ping_ok");
  } catch (error) {
    logRedisStartupFailure(error);
    exitWithStartupError(error, "redis startup failed");
  }

  const serviceState = new ServiceStateTracker("STARTING");
  const statusOptions = {
    timeoutMs: statusCheckTimeoutMs,
    retries: statusCheckRetries
  };

  try {
    const workerCheck = await checkRemoteService(workerHealthUrl, statusOptions);
    if (workerCheck.status !== "up") {
      serviceState.setState(
        "DEGRADED",
        `worker_down: worker=${summarizeRemoteCheck(workerCheck)}`
      );
      startupLogger.warn("event=dependency_check result=degraded reason=worker_down");
    } else {
      serviceState.setState("READY");
      startupLogger.info("event=dependency_check result=ready");
    }
  } catch (error) {
    serviceState.setState("DEGRADED", "worker_check_failed");
    startupLogger.warn("event=dependency_check result=degraded reason=check_failed");
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url || req.method !== "POST" || req.url !== "/command") {
      res.statusCode = 404;
      res.end();
      return;
    }

    const ip = getClientIp(req);
    try {
      const { allowed } = await rateLimit(
        redis,
        `ratelimit:${ip}`,
        rateLimitMax,
        rateWindow
      );
      if (!allowed) {
        res.statusCode = 429;
        res.end("Rate limit exceeded");
        return;
      }
    } catch {
      res.statusCode = 500;
      res.end("Rate limiter error");
      return;
    }

    if (maxLoad !== null) {
      const metrics = getLoadMetrics();
      if (metrics.load1 > maxLoad) {
        res.statusCode = 503;
        res.end("Service overloaded");
        return;
      }
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        res.statusCode = 413;
        res.end("Payload too large");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", async () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        const payload = parsePayload(body);
        const jobId = payload.idempotencyKey ?? crypto.randomUUID();
        const job = createJob(jobId, payload.type, payload.payload, 5);
        await enqueueJob(redis, queueName, job);
        res.statusCode = 202;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ jobId }));
      } catch (error) {
        res.statusCode = 400;
        res.end("Invalid request");
      }
    });
  });

  const botHost = "0.0.0.0";
  const healthHost = "0.0.0.0";

  httpLogger.info(`event=http_start host=${botHost} port=${port}`);
  server.listen(port, botHost, () => {
    httpLogger.info(`event=http_listen host=${botHost} port=${port}`);
  });

  healthLogger.info(`event=health_start host=${healthHost} port=${healthPort}`);
  const healthServer = startHealthServer({
    serviceName: "bot",
    port: healthPort,
    host: healthHost,
    getVersion: () => loadVersionInfo(gitRepoPath),
    getState: () => serviceState.getSnapshot(),
    deriveState: (checks) => {
      deriveBotState(serviceState, checks);
      return serviceState.getSnapshot();
    },
    checks: {
      redis: async () => checkRedisHealth(redis, healthCheckTimeoutMs),
      postgres: async () => {
        if (!postgresPool) {
          return { ok: true, reason: "not_configured" };
        }
        return checkPostgresHealth(postgresPool, healthCheckTimeoutMs);
      },
      worker: async () => {
        const result = await checkRemoteService(workerHealthUrl, {
          timeoutMs: healthCheckTimeoutMs,
          retries: 1
        });
        return {
          ok: result.status === "up",
          reason: result.reason,
          latencyMs: result.latencyMs,
          statusCode: result.statusCode
        };
      },
      ...Object.fromEntries(
        extraCheckUrls.map((url, index) => [
          `external_${index + 1}`,
          async () => {
            const result = await checkRemoteService(url, {
              timeoutMs: healthCheckTimeoutMs,
              retries: 1
            });
            return {
              ok: result.status === "up",
              reason: result.reason,
              latencyMs: result.latencyMs,
              statusCode: result.statusCode
            };
          }
        ])
      )
    }
  });
  healthServer.on("listening", () => {
    healthLogger.info(`event=health_listen host=${healthHost} port=${healthPort}`);
  });

  const client = new Client({
    // GuildMembers intent is unavailable in this discord.js build.
    intents: [GatewayIntentBits.Guilds],
    makeCache: Options.cacheWithLimits({
      MessageManager: 0,
      PresenceManager: 0,
      GuildMemberManager: 0,
      ReactionManager: 0,
      VoiceStateManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
      ThreadManager: 0,
      StageInstanceManager: 0,
      GuildBanManager: 0
    }),
    sweepers: {
      messages: {
        interval: 300,
        lifetime: 300
      },
      users: {
        interval: 300,
        filter: () => () => true
      },
      guildMembers: {
        interval: 300,
        filter: () => () => true
      }
    }
  });
  const readyPromise = new Promise<void>((resolve, reject) => {
    client.once("ready", () => {
      discordLogger.info("event=discord_ready");
      resolve();
    });
    client.once("error", (error: Error) => {
      reject(error);
    });
  });

  const rest = new REST({ version: "10" }).setToken(discordToken);
  const commandsDir = path.join(__dirname, "commands");
  try {
    const definitions = await reloadDiscordCommands({
      commandsDir,
      rest,
      discordAppId
    });
    registerCommandDefinitions(definitions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    discordLogger.fatal(`event=command_reload_failed message="${message}"`);
    throw error;
  }

  const commandContext: CommandExecutionContext = {
    client,
    gitRepoPath,
    workerHealthUrl,
    statusCheckTimeoutMs,
    statusCheckRetries,
    redis,
    postgresPool,
    serviceMode: process.env.SERVICE_MODE ?? "bot",
    getVersion: () => loadVersionInfo(gitRepoPath)
  };

  client.on("interactionCreate", async (interaction) => {
    try {
      await handleInteraction({ interaction, legacyContext: commandContext });
    } catch (error) {
      const stack =
        error instanceof Error ? error.stack ?? error.message : String(error);
      discordLogger.error("event=command_handler_failed");
      discordLogger.error(`stack=\"${sanitizeErrorStack(stack)}\"`);
    }
  });

  discordLogger.info("event=discord_login");
  await client.login(discordToken);
  await readyPromise;

  registerGracefulShutdown([
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    () =>
      new Promise<void>((resolve) => {
        healthServer.close(() => resolve());
      }),
    async () => {
      if (postgresPool) {
        await postgresPool.end();
      }
    },
    async () => {
      await redis.quit();
    },
    async () => {
      client.destroy();
    }
  ]);
}

void main().catch((error) => {
  exitWithStartupError(error, "startup failed");
});
