import fs from "fs";
import Redis from "ioredis";

export type RedisClient = Redis;

const REQUIRED_ENV = [
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_TLS",
  "REDIS_TLS_REJECT_UNAUTHORIZED",
  "REDIS_CONNECT_TIMEOUT_MS",
  "REDIS_ENABLE_READY_CHECK",
  "REDIS_ENABLE_OFFLINE_QUEUE",
  "REDIS_LAZY_CONNECT",
  "REDIS_MAX_RETRIES_PER_REQUEST",
  "REDIS_RETRY_MAX_ATTEMPT",
  "REDIS_RETRY_BASE_DELAY_MS",
  "REDIS_RETRY_JITTER_MS",
  "REDIS_RETRY_MAX_DELAY_MS"
];

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

function parseBoolean(name: string): boolean {
  const value = getRequiredEnv(name).toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be "true" or "false"`);
}

function parsePositiveInteger(name: string): number {
  const value = Number(getRequiredEnv(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function getRedisUsername(): string | undefined {
  return getOptionalEnv("REDIS_USERNAME");
}

function parseRedisTlsEnabled(): boolean {
  return parseBoolean("REDIS_TLS");
}

function parseRejectUnauthorized(): boolean {
  return parseBoolean("REDIS_TLS_REJECT_UNAUTHORIZED");
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

  const connectTimeout = parsePositiveInteger("REDIS_CONNECT_TIMEOUT_MS");
  const enableReadyCheck = parseBoolean("REDIS_ENABLE_READY_CHECK");
  const enableOfflineQueue = parseBoolean("REDIS_ENABLE_OFFLINE_QUEUE");
  const lazyConnect = parseBoolean("REDIS_LAZY_CONNECT");
  const maxRetriesPerRequest = parsePositiveInteger("REDIS_MAX_RETRIES_PER_REQUEST");
  const retryMaxAttempt = parsePositiveInteger("REDIS_RETRY_MAX_ATTEMPT");
  const retryBaseDelay = parsePositiveInteger("REDIS_RETRY_BASE_DELAY_MS");
  const retryJitter = parsePositiveInteger("REDIS_RETRY_JITTER_MS");
  const retryMaxDelay = parsePositiveInteger("REDIS_RETRY_MAX_DELAY_MS");

  const client = new Redis({
    host,
    port,
    ...(password ? { password } : {}),
    ...(tlsOptions ? { tls: tlsOptions } : {}),
    ...(username ? { username } : {}),
    connectTimeout,
    enableReadyCheck,
    enableOfflineQueue,
    lazyConnect,
    maxRetriesPerRequest,
    retryStrategy: (attempt) => {
      const cappedAttempt = Math.min(attempt, retryMaxAttempt);
      const jitter = Math.floor(Math.random() * retryJitter);
      return Math.min(retryBaseDelay * 2 ** cappedAttempt + jitter, retryMaxDelay);
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
