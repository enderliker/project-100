import http from "http";
import crypto from "crypto";
import {
  createHealthServer,
  createJob,
  createRedisClient,
  enqueueJob,
  getLoadMetrics,
  rateLimit,
  registerGracefulShutdown
} from "@project/shared";

const REQUIRED_ENV = ["BOT_PORT", "BOT_RATE_LIMIT", "BOT_RATE_WINDOW_SEC"];

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseNumber(name: string): number {
  const value = Number(getRequiredEnv(name));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
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
  for (const env of REQUIRED_ENV) {
    getRequiredEnv(env);
  }

  const port = parseNumber("BOT_PORT");
  const rateLimitMax = parseNumber("BOT_RATE_LIMIT");
  const rateWindow = parseNumber("BOT_RATE_WINDOW_SEC");
  const queueName = process.env.BOT_QUEUE_NAME ?? "jobs:main";
  const maxLoad = process.env.BOT_MAX_LOAD1 ? Number(process.env.BOT_MAX_LOAD1) : null;

  const redis = createRedisClient();

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

  server.listen(port);

  const healthPort = process.env.HEALTH_PORT
    ? Number(process.env.HEALTH_PORT)
    : port + 1;
  const healthServer = createHealthServer({
    port: healthPort,
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

  registerGracefulShutdown([
    () => server.close(),
    () => healthServer.close(),
    async () => {
      await redis.quit();
    }
  ]);
}

void main();
