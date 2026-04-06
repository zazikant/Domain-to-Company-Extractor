import { Redis } from "@upstash/redis";
import { TIMEOUT_UPSTASH_REDIS_MS } from "./constants";

const MAX_REQUESTS = 1000;
const WINDOW_SECONDS = 60;

let redis: Redis | null = null;

/**
 * Initialize (or re-initialize) the Upstash Redis client.
 * Accepts caller-provided URL and token so no server-side secrets are needed.
 */
export function initRedis(url: string, token: string): Redis {
  redis = new Redis({ url, token });
  return redis;
}

/**
 * Sliding-window rate limit using Upstash Redis INCR + EXPIRE.
 * Falls back to allow-all if Redis is not initialized or errors out.
 * Warns if a single round-trip exceeds 50ms.
 */
export async function checkRateLimit(
  ip: string
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!redis) {
    // No Redis configured — allow through (dev / degraded mode)
    console.warn("[RateLimit] Redis not initialized, skipping rate limit");
    return { allowed: true, remaining: MAX_REQUESTS, resetAt: Date.now() + WINDOW_SECONDS * 1000 };
  }

  const key = `ratelimit:${ip}`;

  try {
    const startMs = Date.now();

    const [countStr, ttlSec] = await Promise.all([
      redis.incr(key),
      redis.expire(key, WINDOW_SECONDS),
    ]);

    const elapsed = Date.now() - startMs;
    if (elapsed > TIMEOUT_UPSTASH_REDIS_MS) {
      console.warn(`[RateLimit] Redis round-trip took ${elapsed}ms (threshold: ${TIMEOUT_UPSTASH_REDIS_MS}ms)`);
    }

    const count = Number(countStr);

    if (count === 1) {
      // First request in this window
      const remaining = MAX_REQUESTS - count;
      return {
        allowed: remaining >= 0,
        remaining: Math.max(remaining, 0),
        resetAt: Date.now() + WINDOW_SECONDS * 1000,
      };
    }

    const remaining = MAX_REQUESTS - count;
    const resetAt = Date.now() + (typeof ttlSec === "number" ? ttlSec : WINDOW_SECONDS) * 1000;

    if (remaining < 0) {
      return { allowed: false, remaining: 0, resetAt };
    }

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  } catch (error) {
    // Redis error — fail open rather than blocking all traffic
    console.warn("[RateLimit] Redis error, failing open:", error);
    return { allowed: true, remaining: MAX_REQUESTS, resetAt: Date.now() + WINDOW_SECONDS * 1000 };
  }
}
