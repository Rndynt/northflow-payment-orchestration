import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  const startedAt = Date.now();
  console.log(JSON.stringify({ level: 'info', event: 'request_start', requestId, method: req.method, path: req.path }));
  res.on('finish', () => {
    console.log(JSON.stringify({ level: 'info', event: 'request_end', requestId, method: req.method, path: req.path, statusCode: res.statusCode, durationMs: Date.now() - startedAt }));
  });
  next();
}
