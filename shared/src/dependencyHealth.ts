import { Pool } from "pg";
import { RedisClient } from "./redis";
import { HealthCheckResult } from "./health";

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number
): Promise<{ ok: true; value: T; latencyMs: number } | { ok: false; reason: string }> {
  const start = Date.now();

  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
  });

  try {
    const value = await Promise.race([task, timeout]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    return { ok: true, value, latencyMs: Date.now() - start };
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    const message = error instanceof Error ? error.message : "unknown_error";
    return { ok: false, reason: message };
  }
}

export async function checkRedisHealth(
  redis: RedisClient,
  timeoutMs: number
): Promise<HealthCheckResult> {
  const result = await withTimeout(redis.ping(), timeoutMs);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return { ok: true, latencyMs: result.latencyMs };
}

export async function checkPostgresHealth(
  pool: Pool,
  timeoutMs: number
): Promise<HealthCheckResult> {
  const result = await withTimeout(pool.query("SELECT 1"), timeoutMs);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return { ok: true, latencyMs: result.latencyMs };
}
