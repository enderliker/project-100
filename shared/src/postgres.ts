import fs from "fs";
import { Pool, QueryResult } from "pg";

export interface PreparedQuery {
  name: string;
  text: string;
  values?: unknown[];
}

const REQUIRED_ENV = [
  "PG_HOST",
  "PG_PORT",
  "PG_USER",
  "PG_PASSWORD",
  "PG_DATABASE",
  "PG_POOL_MAX",
  "PG_IDLE_TIMEOUT_MS",
  "PG_SSL_REJECT_UNAUTHORIZED",
  "PG_QUERY_MAX_RETRIES",
  "PG_QUERY_BASE_DELAY_MS",
  "PG_QUERY_MAX_DELAY_MS"
];

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PG_PORT must be a positive integer");
  }
  return port;
}

function parsePositiveInteger(name: string): number {
  const value = Number(getRequiredEnv(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
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

function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } {
  const rejectUnauthorized = parseBoolean("PG_SSL_REJECT_UNAUTHORIZED");
  const caPath = process.env.PG_CA_PATH;
  if (caPath) {
    const ca = fs.readFileSync(caPath, "utf-8");
    return { rejectUnauthorized, ca };
  }
  return { rejectUnauthorized };
}

export function createPostgresPool(): Pool {
  for (const name of REQUIRED_ENV) {
    getRequiredEnv(name);
  }

  const pool = new Pool({
    host: getRequiredEnv("PG_HOST"),
    port: parsePort(getRequiredEnv("PG_PORT")),
    user: getRequiredEnv("PG_USER"),
    password: getRequiredEnv("PG_PASSWORD"),
    database: getRequiredEnv("PG_DATABASE"),
    max: parsePositiveInteger("PG_POOL_MAX"),
    idleTimeoutMillis: parsePositiveInteger("PG_IDLE_TIMEOUT_MS"),
    ssl: buildSslConfig()
  });

  return pool;
}

const TRANSIENT_ERROR_CODES = new Set([
  "40001",
  "40P01",
  "57P01",
  "57P02",
  "57P03",
  "08006",
  "08003",
  "08000",
  "08001",
  "08004",
  "08007",
  "08P01"
]);

function isTransientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const typed = error as { code?: string; message?: string };
  if (typed.code && TRANSIENT_ERROR_CODES.has(typed.code)) {
    return true;
  }
  if (typed.message && /ECONNRESET|ETIMEDOUT/i.test(typed.message)) {
    return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function queryPrepared(
  pool: Pool,
  query: PreparedQuery,
  options: { maxRetries: number; baseDelayMs: number; maxDelayMs: number }
): Promise<QueryResult> {
  if (!query.name) {
    throw new Error("Prepared statements require a non-empty name");
  }

  const { maxRetries, baseDelayMs, maxDelayMs } = options;
  if (!Number.isInteger(maxRetries) || maxRetries <= 0) {
    throw new Error("PG_QUERY_MAX_RETRIES must be a positive integer");
  }
  if (!Number.isInteger(baseDelayMs) || baseDelayMs <= 0) {
    throw new Error("PG_QUERY_BASE_DELAY_MS must be a positive integer");
  }
  if (!Number.isInteger(maxDelayMs) || maxDelayMs <= 0) {
    throw new Error("PG_QUERY_MAX_DELAY_MS must be a positive integer");
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await pool.query({
        name: query.name,
        text: query.text,
        values: query.values
      });
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries || !isTransientError(error)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      await sleep(delay);
    }
  }
}
