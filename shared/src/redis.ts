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

export function createRedisClient(): RedisClient {
  for (const name of REQUIRED_ENV) {
    getRequiredEnv(name);
  }

  const host = getRequiredEnv("REDIS_HOST");
  const port = Number(getRequiredEnv("REDIS_PORT"));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("REDIS_PORT must be a positive integer");
  }

  const password = getRequiredEnv("REDIS_PASSWORD");
  const username = process.env.REDIS_USERNAME;
  const caPath = getRequiredEnv("REDIS_CA_PATH");
  const ca = fs.readFileSync(caPath, "utf-8");

  return new Redis({
    host,
    port,
    username,
    password,
    tls: {
      ca,
      rejectUnauthorized: true
    },
    enableReadyCheck: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 5,
    retryStrategy: (attempt) => {
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      return delay;
    }
  });
}
