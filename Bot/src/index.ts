import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  Client,
  GatewayIntentBits,
  Interaction,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import {
  createJob,
  createRedisClient,
  enqueueJob,
  getLoadMetrics,
  rateLimit,
  registerGracefulShutdown,
  runGitAutopullOnceOnStartup,
  startHealthChecker,
  startHealthServer,
  createLogger
} from "@project/shared";

const REQUIRED_ENV = [
  "BOT_PORT",
  "BOT_RATE_LIMIT",
  "BOT_RATE_WINDOW_SEC",
  "BOT_QUEUE_NAME",
  "BOT_HOST",
  "HEALTH_HOST",
  "HEALTH_PORT",
  "BOT_CHECK_URLS",
  "HEALTH_CHECK_INTERVAL_MS",
  "HEALTH_CHECK_TIMEOUT_MS",
  "GIT_REPO_PATH",
  "GIT_REMOTE",
  "GIT_BRANCH",
  "GIT_AUTOPULL_INTERVAL_MS",
  "DISCORD_TOKEN",
  "DISCORD_APP_ID"
];

const SENSITIVE_ENV = ["DISCORD_TOKEN", "REDIS_PASSWORD", "PG_PASSWORD"];
const startupLogger = createLogger("startup");
const redisLogger = createLogger("redis");
const httpLogger = createLogger("http");
const healthLogger = createLogger("health");
const discordLogger = createLogger("discord");

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
  startupLogger.error(context);
  startupLogger.error(sanitizeErrorStack(stack));
  process.exit(1);
}

function exitWithConfigError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  startupLogger.error(`config invalid: ${message}`);
  process.exit(1);
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

function parseUrlList(name: string): string[] {
  const raw = getRequiredEnv(name);
  const urls = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (urls.length === 0) {
    throw new Error(`${name} must include at least one URL`);
  }
  return urls;
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

function loadVersion(): string | null {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function formatUptime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

function buildStatusMessage(params: {
  serviceMode: string;
  uptimeSeconds: number;
  gatewayPingMs: number;
  redisConnected: boolean;
  postgresStatus: string;
  version: string | null;
}): string {
  const lines = [
    `Service: ${params.serviceMode}`,
    `Uptime: ${formatUptime(params.uptimeSeconds)}`,
    `Gateway ping: ${Math.round(params.gatewayPingMs)}ms`,
    `Redis: ${params.redisConnected ? "connected" : "disconnected"}`,
    `Postgres: ${params.postgresStatus}`,
    `Version: ${params.version ?? "unknown"}`
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  startupLogger.info("env loaded");

  let port: number;
  let rateLimitMax: number;
  let rateWindow: number;
  let queueName: string;
  let maxLoad: number | null;
  let botHost: string;
  let healthHost: string;
  let healthPort: number;
  let checkerUrls: string[];
  let checkerIntervalMs: number;
  let checkerTimeoutMs: number;
  let gitRepoPath: string;
  let gitRemote: string;
  let gitBranch: string;
  let discordToken: string;
  let discordAppId: string;

  try {
    for (const env of REQUIRED_ENV) {
      getRequiredEnv(env);
    }

    port = parseNumber("BOT_PORT");
    rateLimitMax = parseNumber("BOT_RATE_LIMIT");
    rateWindow = parseNumber("BOT_RATE_WINDOW_SEC");
    queueName = getRequiredEnv("BOT_QUEUE_NAME");
    maxLoad = parseOptionalNumber("BOT_MAX_LOAD1");
    botHost = getRequiredEnv("BOT_HOST");
    healthHost = getRequiredEnv("HEALTH_HOST");
    healthPort = parseNumber("HEALTH_PORT");
    checkerUrls = parseUrlList("BOT_CHECK_URLS");
    checkerIntervalMs = parseNumber("HEALTH_CHECK_INTERVAL_MS");
    checkerTimeoutMs = parseNumber("HEALTH_CHECK_TIMEOUT_MS");
    gitRepoPath = getRequiredEnv("GIT_REPO_PATH");
    gitRemote = getRequiredEnv("GIT_REMOTE");
    gitBranch = getRequiredEnv("GIT_BRANCH");
    parseNumber("GIT_AUTOPULL_INTERVAL_MS");
    discordToken = getRequiredEnv("DISCORD_TOKEN");
    discordAppId = getDiscordAppId();
  } catch (error) {
    exitWithConfigError(error);
  }

  startupLogger.info("config validated");

  await runGitAutopullOnceOnStartup({
    repoPath: gitRepoPath,
    remote: gitRemote,
    branch: gitBranch
  });

  const redis = createRedisClient();
  try {
    redisLogger.info("connecting");
    await redis.connect();
    await redis.ping();
    redisLogger.info("connection ready (ping ok)");
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

  httpLogger.info(`starting server host=${botHost} port=${port}`);
  server.listen(port, botHost, () => {
    httpLogger.info(`server listening host=${botHost} port=${port}`);
  });

  healthLogger.info(`starting server host=${healthHost} port=${healthPort}`);
  const healthServer = startHealthServer("bot", { port: healthPort, host: healthHost });
  healthServer.on("listening", () => {
    healthLogger.info(`server listening host=${healthHost} port=${healthPort}`);
  });

  const checkerTimer = startHealthChecker("bot", checkerUrls, {
    intervalMs: checkerIntervalMs,
    timeoutMs: checkerTimeoutMs
  });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const readyPromise = new Promise<void>((resolve, reject) => {
    client.once("ready", () => {
      discordLogger.info("ready");
      resolve();
    });
    client.once("error", (error: Error) => {
      reject(error);
    });
  });

  const commands = [
    new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
    new SlashCommandBuilder().setName("status").setDescription("Show service status")
  ].map((command) => command.toJSON());
  const rest = new REST({ version: "10" }).setToken(discordToken);
  await rest.put(Routes.applicationCommands(discordAppId), { body: commands });

  client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName === "ping") {
      const latency = Date.now() - interaction.createdTimestamp;
      await interaction.reply(`pong (${latency}ms)`);
      return;
    }

    if (interaction.commandName === "status") {
      const version = loadVersion();
      const statusMessage = buildStatusMessage({
        serviceMode: process.env.SERVICE_MODE ?? "bot",
        uptimeSeconds: process.uptime(),
        gatewayPingMs: client.ws.ping,
        redisConnected: redis.status === "ready",
        postgresStatus: "not configured",
        version
      });
      await interaction.reply(statusMessage);
    }
  });

  discordLogger.info("login starting");
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
    () => {
      if (checkerTimer) {
        clearInterval(checkerTimer);
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
