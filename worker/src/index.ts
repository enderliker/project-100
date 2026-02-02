import {
  createPostgresPool,
  createRedisClient,
  dequeueJob,
  queryPrepared,
  registerGracefulShutdown,
  requeueJob,
  sendToDeadLetter
} from "@project/shared";
import { RedisClient } from "@project/shared";

const REQUIRED_ENV = ["WORKER_QUEUE_NAME"];

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

async function ensureTable(): Promise<void> {
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
  });
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
  for (const env of REQUIRED_ENV) {
    getRequiredEnv(env);
  }

  await ensureTable();

  const queueName = getRequiredEnv("WORKER_QUEUE_NAME");
  const deadLetterQueue = process.env.WORKER_DEAD_LETTER_QUEUE ?? "jobs:dead-letter";
  const maxAttempts = parseNumber("WORKER_MAX_ATTEMPTS", 5);
  const idempotencyTtl = parseNumber("WORKER_IDEMPOTENCY_TTL_SEC", 86400);
  const baseBackoffMs = parseNumber("WORKER_BACKOFF_BASE_MS", 500);

  const redis = createRedisClient();
  const pool = createPostgresPool();
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    logRedisStartupFailure(error);
    process.exit(1);
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
        await queryPrepared(pool, {
          name: "insert-job-result",
          text: `
            INSERT INTO job_results (job_id, worker_name, job_type, payload)
            VALUES ($1, $2, $3, $4)
          `,
          values: [job.id, "worker", job.type, job.payload]
        });
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
    async () => {
      await pool.end();
    },
    async () => {
      await redis.quit();
    }
  ]);
}

void main();
