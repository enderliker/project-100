import fs from "fs";
import Redis from "ioredis";

export type RedisClient = Redis;

const REQUIRED_ENV = [
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_PASSWORD",
  "REDIS_CA_PATH"
];

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
  const username = process.env.REDIS_USERNAME;
  if (!username || username.trim().length === 0) {
    return undefined;
  }
  return username;
}

export function createRedisClient(): RedisClient {
  for (const name of REQUIRED_ENV) {
    getRequiredEnv(name);
  }

  const host = getRequiredEnv("REDIS_HOST");
  const port = parseRedisPort();

  const password = getRequiredEnv("REDIS_PASSWORD");
  const username = getRedisUsername();
  const caPath = getRequiredEnv("REDIS_CA_PATH");
  const ca = fs.readFileSync(caPath, "utf-8");

  const client = new Redis({
    host,
    port,
    password,
    tls: {
      ca,
      rejectUnauthorized: true
    },
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
    console.error(`[redis] error: ${sanitizeRedisErrorMessage(message)}`);
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
