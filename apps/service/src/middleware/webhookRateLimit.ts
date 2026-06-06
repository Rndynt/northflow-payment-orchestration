import type { Request, Response, NextFunction } from 'express';
import { apiErrorResponse } from '../routes/utils.ts';

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

export function createWebhookRateLimitMiddleware(limit = Number(process.env['PAYMENT_ORCHESTRATION_WEBHOOK_RATE_LIMIT'] ?? 120), windowMs = Number(process.env['PAYMENT_ORCHESTRATION_WEBHOOK_RATE_WINDOW_MS'] ?? 60_000)) {
  return function webhookRateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = `${req.ip}:${req.params['provider'] ?? ''}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      res.status(429).json(apiErrorResponse('RATE_LIMITED', 'Webhook rate limit exceeded.'));
      return;
    }
    next();
  };
}
