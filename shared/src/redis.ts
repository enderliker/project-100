import fs from "fs";
import Redis from "ioredis";

export type RedisClient = Redis;

const REQUIRED_ENV = ["REDIS_HOST", "REDIS_PORT"];

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeRedisErrorMessage(message: string): string {
  const password = process.env.REDIS_PASSWORD;
  if (password && password.length > 0) {
    return message.split(password).join("***");
  }
  return message;
}

function parseRedisPort(): number {
  const port = Number(getRequiredEnv("REDIS_PORT"));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("REDIS_PORT must be a positive integer");
  }
  return port;
}

function getRedisUsername(): string | undefined {
  return getOptionalEnv("REDIS_USERNAME");
}

function parseRedisTlsEnabled(): boolean {
  return process.env.REDIS_TLS === "true";
}

function parseRejectUnauthorized(): boolean {
  const value = process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
  if (!value) {
    return true;
  }
  return value === "true";
}

function logRedisConfig({
  host,
  port,
  tlsEnabled,
  authEnabled,
  username
}: {
  host: string;
  port: number;
  tlsEnabled: boolean;
  authEnabled: boolean;
  username?: string;
}): void {
  const usernamePart = username ? ` username=${username}` : "";
  console.info(
    `[redis] config host=${host} port=${port} tls=${tlsEnabled ? "on" : "off"} auth=${authEnabled ? "on" : "off"}${usernamePart}`
  );
}

export function createRedisClient(): RedisClient {
  for (const name of REQUIRED_ENV) {
    getRequiredEnv(name);
  }

  const host = getRequiredEnv("REDIS_HOST");
  const port = parseRedisPort();

  const password = getOptionalEnv("REDIS_PASSWORD");
  const username = getRedisUsername();
  if (username && !password) {
    throw new Error("REDIS_USERNAME is set but REDIS_PASSWORD is missing.");
  }

  const tlsEnabled = parseRedisTlsEnabled();
  const caPath = getOptionalEnv("REDIS_CA_PATH");
  if (!tlsEnabled && caPath) {
    console.warn(
      '[redis] REDIS_CA_PATH is set but REDIS_TLS is not "true"; ignoring CA file.'
    );
  }

  const tlsOptions = tlsEnabled
    ? {
        ...(caPath ? { ca: fs.readFileSync(caPath, "utf-8") } : {}),
        rejectUnauthorized: parseRejectUnauthorized()
      }
    : undefined;

  logRedisConfig({
    host,
    port,
    tlsEnabled,
    authEnabled: Boolean(password),
    username
  });

  const client = new Redis({
    host,
    port,
    ...(password ? { password } : {}),
    ...(tlsOptions ? { tls: tlsOptions } : {}),
    ...(username ? { username } : {}),
    connectTimeout: 10000,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 5,
    retryStrategy: (attempt) => {
      const cappedAttempt = Math.min(attempt, 8);
      const baseDelay = 250;
      const jitter = Math.floor(Math.random() * 250);
      return Math.min(baseDelay * 2 ** cappedAttempt + jitter, 30000);
    }
  });

  client.on("error", (error) => {
    const message =
      error instanceof Error ? error.message : "Unknown Redis client error";
    const sanitized = sanitizeRedisErrorMessage(message);
    if (sanitized.includes("WRONGPASS")) {
      console.error(
        "[redis] error: WRONGPASS invalid username-password pair or user is disabled. Exiting."
      );
      process.exit(1);
    }
    console.error(`[redis] error: ${sanitized}`);
  });

  client.on("ready", () => {
    console.info("[redis] connection ready");
  });

  client.on("end", () => {
    console.warn("[redis] connection closed");
  });

  client.on("reconnecting", (time: number) => {
    console.warn(`[redis] reconnecting in ${time}ms`);
  });

  return client;
}
