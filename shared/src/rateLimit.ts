import { RedisClient } from "./redis";

export async function rateLimit(
  redis: RedisClient,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const transaction = redis.multi();
  transaction.incr(key);
  transaction.ttl(key);
  const result = await transaction.exec();
  if (!result) {
    throw new Error("Rate limit transaction failed");
  }

  const count = Number(result[0][1]);
  const ttl = Number(result[1][1]);
  if (ttl < 0) {
    await redis.expire(key, windowSeconds);
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(limit - count, 0)
  };
}
