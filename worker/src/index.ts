import {
  createPostgresPool,
  createRedisClient,
  checkPostgresHealth,
  checkRedisHealth,
  dequeueJob,
  parsePgQueryMaxRetries,
  queryPrepared,
  registerGracefulShutdown,
  requeueJob,
  sendToDeadLetter,
  runGitUpdateOnce,
  startHealthServer,
  createLogger,
  checkRemoteService,
  normalizeStatusCheckOptions,
  ServiceStateTracker
} from "@project/shared";
import { RedisClient } from "@project/shared";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { URL } from "url";

const REQUIRED_ENV = [
  "WORKER_QUEUE_NAME",
  "WORKER_DEAD_LETTER_QUEUE",
  "WORKER_MAX_ATTEMPTS",
  "WORKER_IDEMPOTENCY_TTL_SEC",
  "WORKER_BACKOFF_BASE_MS",
  "HEALTH_CHECK_INTERVAL_MS",
  "HEALTH_CHECK_TIMEOUT_MS",
  "GIT_REPO_PATH",
  "GIT_REMOTE",
  "GIT_BRANCH",
  "PG_QUERY_BASE_DELAY_MS",
  "PG_QUERY_MAX_DELAY_MS"
];
const SENSITIVE_ENV = ["REDIS_PASSWORD", "PG_PASSWORD"];
const startupLogger = createLogger("startup");
const redisLogger = createLogger("redis");
const postgresLogger = createLogger("postgres");
const healthLogger = createLogger("health");

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNumber(name: string): number {
  const raw = getRequiredEnv(name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function parseOptionalNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number when set`);
  }
  return value;
}

function parseNumberWithDefault(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number when set`);
  }
  return value;
}

function parseOptionalUrl(name: string): string | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return trimmed;
  } catch {
    throw new Error(`${name} must be a valid URL when set`);
  }
}

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

async function ensureTable(queryOptions: {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}): Promise<void> {
  const pool = createPostgresPool();
  await queryPrepared(pool, {
    name: "create-table-job-results",
    text: `
      CREATE TABLE IF NOT EXISTS job_results (
        job_id TEXT PRIMARY KEY,
        worker_name TEXT NOT NULL,
        job_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  }, queryOptions);
  await pool.end();
}

async function markIdempotent(redis: RedisClient, key: string, ttlSeconds: number): Promise<boolean> {
  const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function main(): Promise<void> {
  startupLogger.info("event=env_loaded");

  let queryOptions: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  let queueName: string;
  let deadLetterQueue: string;
  let maxAttempts: number;
  let idempotencyTtl: number;
  let baseBackoffMs: number;
  let healthPort: number;
  let botHealthUrl: string | null;
  let healthCheckTimeoutMs: number;
  let statusCheckTimeoutMs: number;
  let statusCheckRetries: number;
  let gitRepoPath: string;
  let gitRemote: string;
  let gitBranch: string;

  try {
    for (const env of REQUIRED_ENV) {
      getRequiredEnv(env);
    }

    queryOptions = {
      maxRetries: parsePgQueryMaxRetries(startupLogger),
      baseDelayMs: parseNumber("PG_QUERY_BASE_DELAY_MS"),
      maxDelayMs: parseNumber("PG_QUERY_MAX_DELAY_MS")
    };

    queueName = getRequiredEnv("WORKER_QUEUE_NAME");
    deadLetterQueue = getRequiredEnv("WORKER_DEAD_LETTER_QUEUE");
    maxAttempts = parseNumber("WORKER_MAX_ATTEMPTS");
    idempotencyTtl = parseNumber("WORKER_IDEMPOTENCY_TTL_SEC");
    baseBackoffMs = parseNumber("WORKER_BACKOFF_BASE_MS");
    healthPort = parseNumberWithDefault("HEALTH_PORT", 3001);
    botHealthUrl =
      parseOptionalUrl("BOT_HEALTH_URL") ??
      parseOptionalUrl("WORKER_BOT_HEALTH_URL") ??
      null;
    parseNumber("HEALTH_CHECK_INTERVAL_MS");
    healthCheckTimeoutMs = parseNumber("HEALTH_CHECK_TIMEOUT_MS");
    gitRepoPath = getRequiredEnv("GIT_REPO_PATH");
    gitRemote = getRequiredEnv("GIT_REMOTE");
    gitBranch = getRequiredEnv("GIT_BRANCH");
    statusCheckTimeoutMs = parseOptionalNumber("STATUS_CHECK_TIMEOUT_MS") ?? 1500;
    statusCheckRetries = parseOptionalNumber("STATUS_CHECK_RETRIES") ?? 1;
  } catch (error) {
    exitWithConfigError(error);
  }

  try {
    postgresLogger.info("event=postgres_connecting");
    await ensureTable(queryOptions);
    postgresLogger.info("event=postgres_ready");
  } catch (error) {
    exitWithStartupError(error, "postgres startup failed");
  }

  startupLogger.info("event=config_validated");

  await runGitUpdateOnce({
    repoPath: gitRepoPath,
    remote: gitRemote,
    branch: gitBranch
  });

  const redis = createRedisClient();
  const pool = createPostgresPool();
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
  serviceState.setState("READY");

  const healthHost = "0.0.0.0";
  healthLogger.info(`event=health_start host=${healthHost} port=${healthPort}`);
  const healthServer = startHealthServer({
    serviceName: "worker",
    port: healthPort,
    host: healthHost,
    getVersion: () => loadVersionInfo(gitRepoPath),
    getState: () => serviceState.getSnapshot(),
    deriveState: (checks) => {
      const redisOk = checks.redis?.ok ?? false;
      const postgresOk = checks.postgres?.ok ?? false;
      if (!redisOk) {
        serviceState.setState("ERROR", "redis_unreachable");
      } else if (!postgresOk) {
        serviceState.setState("ERROR", "postgres_unreachable");
      } else {
        serviceState.setState("READY");
      }
      return serviceState.getSnapshot();
    },
    checks: {
      redis: async () => checkRedisHealth(redis, healthCheckTimeoutMs),
      postgres: async () => checkPostgresHealth(pool, healthCheckTimeoutMs)
    }
  });
  healthServer.on("listening", () => {
    healthLogger.info(`event=health_listen host=${healthHost} port=${healthPort}`);
  });

  if (botHealthUrl) {
    const statusOptions = normalizeStatusCheckOptions({
      timeoutMs: statusCheckTimeoutMs,
      retries: statusCheckRetries
    });
    try {
      const result = await checkRemoteService(botHealthUrl, statusOptions);
      const latency =
        result.latencyMs === undefined ? "n/a" : `${Math.round(result.latencyMs)}ms`;
      if (result.status === "up") {
        healthLogger.info(`event=bot_health status=up latency=${latency}`);
      } else {
        const reason = result.reason ?? "unreachable";
        healthLogger.warn(
          `event=bot_health status=down reason=${reason} latency=${latency}`
        );
      }
    } catch (error) {
      healthLogger.warn("event=bot_health status=error reason=check_failed");
    }
  }

  let running = true;

  const loop = async (): Promise<void> => {
    while (running) {
      const job = await dequeueJob(redis, queueName, 5);
      if (!job) {
        continue;
      }

      const idempotencyKey = `idem:${job.id}`;
      const canProcess = await markIdempotent(redis, idempotencyKey, idempotencyTtl);
      if (!canProcess) {
        continue;
      }

      try {
        await queryPrepared(
          pool,
          {
            name: "insert-job-result",
            text: `
              INSERT INTO job_results (job_id, worker_name, job_type, payload)
              VALUES ($1, $2, $3, $4)
            `,
            values: [job.id, "worker", job.type, job.payload]
          },
          queryOptions
        );
      } catch (error) {
        job.attempts += 1;
        if (job.attempts >= maxAttempts) {
          await sendToDeadLetter(redis, deadLetterQueue, job);
          continue;
        }
        const delay = Math.min(baseBackoffMs * 2 ** job.attempts, 30000);
        await sleep(delay);
        await requeueJob(redis, queueName, job);
      }
    }
  };

  void loop().catch((error) => {
    serviceState.setState("ERROR", "worker_loop_failed");
    startupLogger.fatal(
      `event=worker_loop_failed message="${error instanceof Error ? error.message : String(error)}"`
    );
    process.exit(1);
  });

  registerGracefulShutdown([
    () => {
      running = false;
    },
    () =>
      new Promise<void>((resolve) => {
        healthServer.close(() => resolve());
      }),
    async () => {
      await pool.end();
    },
    async () => {
      await redis.quit();
    }
  ]);
}

void main().catch((error) => {
  exitWithStartupError(error, "startup failed");
});
