import http from "http";
import crypto from "crypto";
import { Client, GatewayIntentBits } from "discord.js";
import {
  createHealthServer,
  createJob,
  createRedisClient,
  enqueueJob,
  getLoadMetrics,
  rateLimit,
  registerGracefulShutdown
} from "@project/shared";

const REQUIRED_ENV = [
  "BOT_PORT",
  "BOT_RATE_LIMIT",
  "BOT_RATE_WINDOW_SEC",
  "DISCORD_TOKEN",
  "DISCORD_APP_ID"
];

const SENSITIVE_ENV = ["DISCORD_TOKEN", "REDIS_PASSWORD", "PG_PASSWORD"];

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
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

function parseNumber(name: string): number {
  const value = Number(getRequiredEnv(name));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function getDiscordAppId(): string {
  const value = getRequiredEnv("DISCORD_APP_ID");
  if (!/^\d+$/.test(value)) {
    throw new Error("DISCORD_APP_ID must be a numeric Discord application id");
  }
  return value;
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
    console.error(
      "[redis] authentication failed (WRONGPASS). Check REDIS_USERNAME/REDIS_PASSWORD."
    );
    return;
  }
  console.error(`[redis] startup failed: ${message}`);
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

async function main(): Promise<void> {
  console.info("[startup] env loaded");

  for (const env of REQUIRED_ENV) {
    getRequiredEnv(env);
  }

  const port = parseNumber("BOT_PORT");
  const rateLimitMax = parseNumber("BOT_RATE_LIMIT");
  const rateWindow = parseNumber("BOT_RATE_WINDOW_SEC");
  const queueName = process.env.BOT_QUEUE_NAME ?? "jobs:main";
  const maxLoad = process.env.BOT_MAX_LOAD1 ? Number(process.env.BOT_MAX_LOAD1) : null;
  const discordToken = getRequiredEnv("DISCORD_TOKEN");
  getDiscordAppId();
  console.info("[startup] config validated");

  const redis = createRedisClient();
  try {
    console.info("[redis] connecting");
    await redis.connect();
    await redis.ping();
    console.info("[redis] connection ready (ping ok)");
  } catch (error) {
    logRedisStartupFailure(error);
    exitWithStartupError(error, "redis startup failed");
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

  const host = process.env.BOT_HOST ?? "0.0.0.0";
  console.info(`[http] starting server host=${host} port=${port}`);
  server.listen(port, host, () => {
    console.info(`[http] server listening host=${host} port=${port}`);
  });

  const healthPort = process.env.HEALTH_PORT
    ? Number(process.env.HEALTH_PORT)
    : port + 1;
  console.info(`[health] starting server host=${host} port=${healthPort}`);
  const healthServer = createHealthServer({
    port: healthPort,
    host,
    checks: {
      redis: async () => {
        try {
          await redis.ping();
          return true;
        } catch {
          return false;
        }
      }
    }
  });
  healthServer.on("listening", () => {
    console.info(`[health] server listening host=${host} port=${healthPort}`);
  });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const readyPromise = new Promise<void>((resolve, reject) => {
    client.once("ready", () => {
      console.info("[discord] ready");
      resolve();
    });
    client.once("error", (error) => {
      reject(error);
    });
  });

  console.info("[discord] login starting");
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
