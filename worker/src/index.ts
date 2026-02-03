import {
  createPostgresPool,
  createRedisClient,
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
  normalizeStatusCheckOptions
} from "@project/shared";
import { RedisClient } from "@project/shared";

const REQUIRED_ENV = [
  "WORKER_QUEUE_NAME",
  "WORKER_DEAD_LETTER_QUEUE",
  "WORKER_MAX_ATTEMPTS",
  "WORKER_IDEMPOTENCY_TTL_SEC",
  "WORKER_BACKOFF_BASE_MS",
  "HEALTH_HOST",
  "HEALTH_PORT",
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
  startupLogger.error(context);
  startupLogger.error(sanitizeErrorStack(stack));
  process.exit(1);
}

function exitWithConfigError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  startupLogger.error(`config invalid: ${message}`);
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
  startupLogger.info("env loaded");

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
  let healthHost: string;
  let healthPort: number;
  let botHealthUrl: string | null;
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
    healthHost = getRequiredEnv("HEALTH_HOST");
    healthPort = parseNumber("HEALTH_PORT");
    botHealthUrl =
      process.env.BOT_HEALTH_URL ?? process.env.WORKER_BOT_HEALTH_URL ?? null;
    parseNumber("HEALTH_CHECK_INTERVAL_MS");
    parseNumber("HEALTH_CHECK_TIMEOUT_MS");
    gitRepoPath = getRequiredEnv("GIT_REPO_PATH");
    gitRemote = getRequiredEnv("GIT_REMOTE");
    gitBranch = getRequiredEnv("GIT_BRANCH");
    statusCheckTimeoutMs = parseOptionalNumber("STATUS_CHECK_TIMEOUT_MS") ?? 1500;
    statusCheckRetries = parseOptionalNumber("STATUS_CHECK_RETRIES") ?? 1;
  } catch (error) {
    exitWithConfigError(error);
  }

  try {
    postgresLogger.info("connecting");
    await ensureTable(queryOptions);
    postgresLogger.info("connection ready");
  } catch (error) {
    exitWithStartupError(error, "postgres startup failed");
  }

  startupLogger.info("config validated");

  await runGitUpdateOnce({
    repoPath: gitRepoPath,
    remote: gitRemote,
    branch: gitBranch
  });

  const redis = createRedisClient();
  const pool = createPostgresPool();
  try {
    redisLogger.info("connecting");
    await redis.connect();
    await redis.ping();
    redisLogger.info("connection ready (ping ok)");
  } catch (error) {
    logRedisStartupFailure(error);
    exitWithStartupError(error, "redis startup failed");
  }

  healthLogger.info(`starting server host=${healthHost} port=${healthPort}`);
  const healthServer = startHealthServer("worker", {
    port: healthPort,
    host: healthHost
  });
  healthServer.on("listening", () => {
    healthLogger.info(`server listening host=${healthHost} port=${healthPort}`);
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
        healthLogger.info(`bot health check status=up latency=${latency}`);
      } else {
        const reason = result.reason ?? "unreachable";
        healthLogger.warn(
          `bot health check status=down reason=${reason} latency=${latency}`
        );
      }
    } catch (error) {
      healthLogger.warn("bot health check failed");
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

  void loop();

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
