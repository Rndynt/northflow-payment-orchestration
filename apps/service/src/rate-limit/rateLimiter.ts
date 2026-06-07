/**
 * rateLimiter — S9.2: Rate limiter abstraction and in-memory implementation.
 *
 * Design:
 *   - RateLimiterStore is the port (interface) that rate-limit middleware depends on.
 *   - InMemoryRateLimiterStore is a fixed-window in-process implementation suitable
 *     for development and single-instance deployments.
 *   - The interface is compatible with a future RedisRateLimiterStore — callers
 *     only depend on the interface, not the implementation.
 *
 * Fixed window behaviour:
 *   - Window boundaries are aligned to clock time (e.g. 00:00–01:00, 01:00–02:00).
 *   - Counter resets at every window boundary.
 *   - This is intentionally simple; a sliding-window or token-bucket algorithm can
 *     be implemented in the future without changing the interface.
 *
 * Memory management:
 *   - Stale entries are pruned on every hit to prevent unbounded growth.
 *   - In steady state (many unique keys) the map size is bounded by the number of
 *     active keys within the current window.
 */

export interface RateLimitResult {
  /** Whether the current request is allowed under the rate limit. */
  allowed: boolean;
  /** The configured request limit for this window. */
  limit: number;
  /** Remaining requests in the current window (0 when denied). */
  remaining: number;
  /** Timestamp when the current window resets. */
  resetAt: Date;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number;
}

export interface RateLimiterStore {
  /**
   * Record one hit for the given key and return the current window state.
   *
   * @param key      Unique key identifying the rate-limit bucket.
   * @param windowMs Window length in milliseconds.
   * @param limit    Maximum allowed hits per window.
   */
  hit(key: string, windowMs: number, limit: number): Promise<RateLimitResult>;
}

// ── InMemoryRateLimiterStore ──────────────────────────────────────────────────

interface WindowEntry {
  count: number;
  windowStart: number;
}

export class InMemoryRateLimiterStore implements RateLimiterStore {
  private readonly windows = new Map<string, WindowEntry>();

  async hit(key: string, windowMs: number, limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = new Date(windowStart + windowMs);

    // Prune stale entries from previous windows to prevent unbounded growth.
    // We prune while iterating so we don't need a separate sweep pass.
    for (const [k, entry] of this.windows) {
      if (entry.windowStart !== windowStart) {
        this.windows.delete(k);
      }
    }

    let entry = this.windows.get(key);
    if (!entry || entry.windowStart !== windowStart) {
      entry = { count: 0, windowStart };
      this.windows.set(key, entry);
    }

    entry.count += 1;

    const allowed = entry.count <= limit;
    const remaining = Math.max(0, limit - entry.count);
    const retryAfterSeconds = allowed
      ? 0
      : Math.ceil((windowStart + windowMs - now) / 1000);

    return { allowed, limit, remaining, resetAt, retryAfterSeconds };
  }

  /** Visible for testing: current number of tracked keys. */
  get size(): number {
    return this.windows.size;
  }
}
