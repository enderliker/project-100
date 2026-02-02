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
  "PG_DATABASE"
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

function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } {
  const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false";
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
    max: process.env.PG_POOL_MAX ? Number(process.env.PG_POOL_MAX) : 10,
    idleTimeoutMillis: 30000,
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
  maxRetries = 3
): Promise<QueryResult> {
  if (!query.name) {
    throw new Error("Prepared statements require a non-empty name");
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
      const delay = Math.min(500 * 2 ** attempt, 5000);
      await sleep(delay);
    }
  }
}
