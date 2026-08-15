interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const requestCounters = new Map<string, RateLimitEntry>();

/**
 * Development fallback only. Production should provide a shared, durable
 * rate-limit store (for example Redis) so limits work across Vercel instances.
 */
export function checkInMemoryRateLimit({
  identifier,
  limit,
  windowMilliseconds,
}: {
  identifier: string;
  limit: number;
  windowMilliseconds: number;
}): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = requestCounters.get(identifier);

  if (!existing || existing.resetAt <= now) {
    requestCounters.set(identifier, {
      count: 1,
      resetAt: now + windowMilliseconds,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
