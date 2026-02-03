import {
  createPostgresPool,
  createRedisClient,
  dequeueJob,
  queryPrepared,
  registerGracefulShutdown,
  requeueJob,
  sendToDeadLetter,
  startGitAutoPull,
  startHealthChecker,
  startHealthServer
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
  "WORKER_BOT_HEALTH_URL",
  "HEALTH_CHECK_INTERVAL_MS",
  "HEALTH_CHECK_TIMEOUT_MS",
  "GIT_REPO_PATH",
  "GIT_REMOTE",
  "GIT_BRANCH",
  "GIT_AUTOPULL_INTERVAL_MS",
  "PG_QUERY_MAX_RETRIES",
  "PG_QUERY_BASE_DELAY_MS",
  "PG_QUERY_MAX_DELAY_MS"
];
const SENSITIVE_ENV = ["REDIS_PASSWORD", "PG_PASSWORD"];

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
  console.error(`[startup] ${context}`);
  console.error(sanitizeErrorStack(stack));
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
    console.error(
      "[redis] authentication failed (WRONGPASS). Check REDIS_USERNAME/REDIS_PASSWORD."
    );
    return;
  }
  console.error(`[redis] startup failed: ${message}`);
}

async function main(): Promise<void> {
  console.info("[startup] env loaded");

  for (const env of REQUIRED_ENV) {
    getRequiredEnv(env);
  }

  console.info("[postgres] connecting");
  const queryOptions = {
    maxRetries: parseNumber("PG_QUERY_MAX_RETRIES"),
    baseDelayMs: parseNumber("PG_QUERY_BASE_DELAY_MS"),
    maxDelayMs: parseNumber("PG_QUERY_MAX_DELAY_MS")
  };

  try {
    await ensureTable(queryOptions);
    console.info("[postgres] connection ready");
  } catch (error) {
    exitWithStartupError(error, "postgres startup failed");
  }

  const queueName = getRequiredEnv("WORKER_QUEUE_NAME");
  const deadLetterQueue = getRequiredEnv("WORKER_DEAD_LETTER_QUEUE");
  const maxAttempts = parseNumber("WORKER_MAX_ATTEMPTS");
  const idempotencyTtl = parseNumber("WORKER_IDEMPOTENCY_TTL_SEC");
  const baseBackoffMs = parseNumber("WORKER_BACKOFF_BASE_MS");
  const healthHost = getRequiredEnv("HEALTH_HOST");
  const healthPort = parseNumber("HEALTH_PORT");
  const botHealthUrl = getRequiredEnv("WORKER_BOT_HEALTH_URL");
  const checkerIntervalMs = parseNumber("HEALTH_CHECK_INTERVAL_MS");
  const checkerTimeoutMs = parseNumber("HEALTH_CHECK_TIMEOUT_MS");
  const gitRepoPath = getRequiredEnv("GIT_REPO_PATH");
  const gitRemote = getRequiredEnv("GIT_REMOTE");
  const gitBranch = getRequiredEnv("GIT_BRANCH");
  const gitIntervalMs = parseNumber("GIT_AUTOPULL_INTERVAL_MS");
  console.info("[startup] config validated");

  startGitAutoPull({
    repoPath: gitRepoPath,
    remote: gitRemote,
    branch: gitBranch,
    intervalMs: gitIntervalMs
  });

  const redis = createRedisClient();
  const pool = createPostgresPool();
  try {
    console.info("[redis] connecting");
    await redis.connect();
    await redis.ping();
    console.info("[redis] connection ready (ping ok)");
  } catch (error) {
    logRedisStartupFailure(error);
    exitWithStartupError(error, "redis startup failed");
  }

  console.info(`[health] starting server host=${healthHost} port=${healthPort}`);
  const healthServer = startHealthServer("worker", {
    port: healthPort,
    host: healthHost
  });
  healthServer.on("listening", () => {
    console.info(`[health] server listening host=${healthHost} port=${healthPort}`);
  });

  const checkerUrls = [botHealthUrl];
  const checkerTimer = startHealthChecker("worker", checkerUrls, {
    intervalMs: checkerIntervalMs,
    timeoutMs: checkerTimeoutMs
  });

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
    () => {
      if (checkerTimer) {
        clearInterval(checkerTimer);
      }
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
