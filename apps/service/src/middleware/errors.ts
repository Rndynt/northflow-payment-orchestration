/**
 * errors — global error handler middleware for payment-orchestration-service.
 *
 * Catches unhandled errors from route handlers and returns a consistent
 * JSON error envelope. Never exposes stack traces or raw secrets.
 *
 * Phase 8K frozen envelope:
 *   { "ok": false, "error": { "code": "...", "message": "...", "details": null } }
 */

import type { Request, Response, NextFunction } from 'express';
import { normalizePaymentOrchestrationError } from '../application/errors.ts';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const normalized = normalizePaymentOrchestrationError(err);
  const statusCode = normalized.statusCode;
  const code = normalized.code;
  const message =
    statusCode < 500
      ? normalized.message
      : 'An internal error occurred. Please try again later.';

  if (statusCode >= 500) {
    console.error(JSON.stringify({ level: 'error', event: 'request_error', requestId: (req as any).requestId ?? null, code, message: err.message }));
  }

  res.status(statusCode).json({
    ok: false,
    error: {
      code,
      message,
      details: null,
    },
  });
}

export function createApiError(
  message: string,
  statusCode: number,
  code: string,
): ApiError {
  const err = new Error(message) as ApiError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
