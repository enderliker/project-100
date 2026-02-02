import { RedisClient } from "./redis";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
}

export function createJob(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  maxAttempts: number
): Job {
  return {
    id,
    type,
    payload,
    attempts: 0,
    maxAttempts,
    createdAt: new Date().toISOString()
  };
}

export async function enqueueJob(
  redis: RedisClient,
  queueName: string,
  job: Job
): Promise<void> {
  const payload = JSON.stringify(job);
  await redis.lpush(queueName, payload);
}

export async function dequeueJob(
  redis: RedisClient,
  queueName: string,
  timeoutSeconds: number
): Promise<Job | null> {
  const result = await redis.brpop(queueName, timeoutSeconds);
  if (!result) {
    return null;
  }
  const raw = result[1];
  const parsed = JSON.parse(raw) as Partial<Job>;
  if (!parsed.id || !parsed.type || !parsed.payload || typeof parsed.attempts !== "number") {
    throw new Error("Invalid job payload from queue");
  }
  return {
    id: parsed.id,
    type: parsed.type,
    payload: parsed.payload,
    attempts: parsed.attempts,
    maxAttempts: parsed.maxAttempts ?? 5,
    createdAt: parsed.createdAt ?? new Date().toISOString()
  };
}

export async function requeueJob(
  redis: RedisClient,
  queueName: string,
  job: Job
): Promise<void> {
  const payload = JSON.stringify(job);
  await redis.rpush(queueName, payload);
}

export async function sendToDeadLetter(
  redis: RedisClient,
  queueName: string,
  job: Job
): Promise<void> {
  const payload = JSON.stringify(job);
  await redis.lpush(queueName, payload);
}
