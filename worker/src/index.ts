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
  ServiceStateTracker,
  envParsers,
  loadConfig,
  registerProcessHandlers
} from "@project/shared";
import { RedisClient } from "@project/shared";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const SENSITIVE_ENV = ["REDIS_PASSWORD", "PG_PASSWORD"];
const startupLogger = createLogger("startup");
const redisLogger = createLogger("redis");
const postgresLogger = createLogger("postgres");
const healthLogger = createLogger("health");


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
  registerProcessHandlers({ logger: startupLogger, sensitiveEnv: SENSITIVE_ENV });

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
    const config = loadConfig({
      queueName: {
        name: "WORKER_QUEUE_NAME",
        parse: envParsers.nonEmptyString(),
        required: true
      },
      deadLetterQueue: {
        name: "WORKER_DEAD_LETTER_QUEUE",
        parse: envParsers.nonEmptyString(),
        required: true
      },
      maxAttempts: {
        name: "WORKER_MAX_ATTEMPTS",
        parse: envParsers.positiveNumber(),
        required: true
      },
      idempotencyTtl: {
        name: "WORKER_IDEMPOTENCY_TTL_SEC",
        parse: envParsers.positiveNumber(),
        required: true
      },
      baseBackoffMs: {
        name: "WORKER_BACKOFF_BASE_MS",
        parse: envParsers.positiveNumber(),
        required: true
      },
      healthPort: {
        name: "HEALTH_PORT",
        parse: envParsers.positiveNumber(),
        required: false,
        default: 3001
      },
      botHealthUrl: {
        name: "BOT_HEALTH_URL",
        parse: envParsers.url(),
        required: false,
        default: null
      },
      workerBotHealthUrl: {
        name: "WORKER_BOT_HEALTH_URL",
        parse: envParsers.url(),
        required: false,
        default: null
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
      },
      baseDelayMs: {
        name: "PG_QUERY_BASE_DELAY_MS",
        parse: envParsers.positiveNumber(),
        required: true
      },
      maxDelayMs: {
        name: "PG_QUERY_MAX_DELAY_MS",
        parse: envParsers.positiveNumber(),
        required: true
      }
    });

    queryOptions = {
      maxRetries: parsePgQueryMaxRetries(startupLogger),
      baseDelayMs: config.baseDelayMs,
      maxDelayMs: config.maxDelayMs
    };

    queueName = config.queueName;
    deadLetterQueue = config.deadLetterQueue;
    maxAttempts = config.maxAttempts;
    idempotencyTtl = config.idempotencyTtl;
    baseBackoffMs = config.baseBackoffMs;
    healthPort = config.healthPort;
    botHealthUrl = config.botHealthUrl ?? config.workerBotHealthUrl ?? null;
    healthCheckTimeoutMs = config.healthCheckTimeoutMs;
    gitRepoPath = config.gitRepoPath;
    gitRemote = config.gitRemote;
    gitBranch = config.gitBranch;
    statusCheckTimeoutMs = config.statusCheckTimeoutMs ?? 1500;
    statusCheckRetries = config.statusCheckRetries ?? 1;
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
