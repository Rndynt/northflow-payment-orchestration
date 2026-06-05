/**
 * FakeGatewayWebhookHandler — standalone FakeGateway webhook parser/verifier.
 *
 * Phase 8E: dev/test-only webhook ingestion for FakeGateway.
 *
 * - Does NOT depend on embedded /api/payment-engine webhook code.
 * - Optional HMAC SHA-256 signing via env PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET.
 * - If secret configured → requires x-fakegateway-signature header.
 * - If no secret in non-production → unsigned webhooks accepted (dev convenience).
 * - In production WITHOUT secret → unsigned webhooks rejected (security guardrail).
 *
 * Expected payload shape:
 * {
 *   "event_id": "evt_fake_001",
 *   "provider_reference": "fake_ref_...",
 *   "event_type": "payment.succeeded",
 *   "status": "succeeded"
 * }
 *
 * HMAC note: verifies over the raw request body bytes (Buffer) when available,
 * or stable JSON stringification when only parsed body is available.
 * Always pass rawBody when possible for strongest security.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export type FakeGatewayWebhookStatus =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'ignored'
  | 'pending';

export interface ParsedFakeGatewayWebhookEvent {
  provider: 'fake_gateway';
  providerEventId: string;
  providerReference: string | null;
  eventType: string;
  status: FakeGatewayWebhookStatus;
  rawPayload: Record<string, unknown>;
}

export interface FakeGatewayWebhookHandlerOptions {
  /** Value of PAYMENT_ORCHESTRATION_FAKEGATEWAY_WEBHOOK_SECRET env var, or undefined. */
  webhookSecret?: string | null;
  /** Current NODE_ENV — unsigned webhooks only allowed in non-production when no secret. */
  nodeEnv?: string;
}

export class FakeGatewayWebhookHandler {
  private readonly webhookSecret: string | null;
  private readonly nodeEnv: string;

  constructor(opts: FakeGatewayWebhookHandlerOptions = {}) {
    this.webhookSecret = opts.webhookSecret?.trim() || null;
    this.nodeEnv = opts.nodeEnv ?? process.env['NODE_ENV'] ?? 'development';
  }

  /**
   * Parse and optionally verify a FakeGateway webhook request.
   *
   * @param headers - HTTP request headers (key → value)
   * @param rawBody - Raw request body as Buffer (preferred for HMAC) or parsed object
   * @returns Parsed event
   * @throws Error with statusCode if invalid
   */
  parse(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | Record<string, unknown>,
  ): ParsedFakeGatewayWebhookEvent {
    const payload = this.extractPayload(rawBody);

    // ── Signature verification ────────────────────────────────────────────────
    if (this.webhookSecret) {
      this.verifySignature(headers, rawBody);
    } else if (this.nodeEnv === 'production') {
      throw Object.assign(
        new Error(
          'FakeGateway webhook secret is not configured. ' +
            'Unsigned FakeGateway webhooks are not accepted in production.',
        ),
        { statusCode: 403, code: 'WEBHOOK_SECRET_REQUIRED' },
      );
    }
    // Non-production without secret: unsigned accepted (dev convenience).

    // ── Payload validation ────────────────────────────────────────────────────
    const eventId = payload['event_id'];
    if (typeof eventId !== 'string' || !eventId.trim()) {
      throw Object.assign(
        new Error('Invalid FakeGateway webhook: missing or invalid event_id'),
        { statusCode: 400, code: 'INVALID_WEBHOOK_PAYLOAD' },
      );
    }

    const eventType = payload['event_type'];
    if (typeof eventType !== 'string' || !eventType.trim()) {
      throw Object.assign(
        new Error('Invalid FakeGateway webhook: missing or invalid event_type'),
        { statusCode: 400, code: 'INVALID_WEBHOOK_PAYLOAD' },
      );
    }

    const rawStatus = payload['status'];
    const status = this.mapStatus(rawStatus);
    if (!status) {
      throw Object.assign(
        new Error(
          `Invalid FakeGateway webhook: unrecognised status '${rawStatus}'`,
        ),
        { statusCode: 400, code: 'INVALID_WEBHOOK_PAYLOAD' },
      );
    }

    const providerReference =
      typeof payload['provider_reference'] === 'string' && payload['provider_reference'].trim()
        ? (payload['provider_reference'] as string)
        : null;

    return {
      provider: 'fake_gateway',
      providerEventId: eventId.trim(),
      providerReference,
      eventType: eventType.trim(),
      status,
      rawPayload: payload,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private extractPayload(rawBody: Buffer | Record<string, unknown>): Record<string, unknown> {
    if (Buffer.isBuffer(rawBody)) {
      try {
        const parsed = JSON.parse(rawBody.toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw Object.assign(
            new Error('Invalid FakeGateway webhook: body must be a JSON object'),
            { statusCode: 400, code: 'INVALID_WEBHOOK_PAYLOAD' },
          );
        }
        return parsed as Record<string, unknown>;
      } catch (e: any) {
        if (e?.code === 'INVALID_WEBHOOK_PAYLOAD') throw e;
        throw Object.assign(
          new Error('Invalid FakeGateway webhook: body is not valid JSON'),
          { statusCode: 400, code: 'INVALID_WEBHOOK_PAYLOAD' },
        );
      }
    }
    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      throw Object.assign(
        new Error('Invalid FakeGateway webhook: body must be a JSON object'),
        { statusCode: 400, code: 'INVALID_WEBHOOK_PAYLOAD' },
      );
    }
    return rawBody;
  }

  private verifySignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | Record<string, unknown>,
  ): void {
    const sigHeader = this.getHeader(headers, 'x-fakegateway-signature');
    if (!sigHeader) {
      throw Object.assign(
        new Error(
          'FakeGateway webhook signature missing. ' +
            'Provide x-fakegateway-signature header.',
        ),
        { statusCode: 401, code: 'WEBHOOK_SIGNATURE_MISSING' },
      );
    }

    // Compute HMAC over raw bytes if available; fall back to stable JSON stringify.
    const bodyBytes: Buffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(JSON.stringify(rawBody, Object.keys(rawBody).sort()));

    const expected = createHmac('sha256', this.webhookSecret!)
      .update(bodyBytes)
      .digest('hex');

    // Constant-time comparison to avoid timing attacks.
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(sigHeader.replace(/^sha256=/, ''), 'hex');

    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw Object.assign(
        new Error('FakeGateway webhook signature verification failed.'),
        { statusCode: 401, code: 'WEBHOOK_SIGNATURE_INVALID' },
      );
    }
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | null {
    const val = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0] ?? null;
    return val ?? null;
  }

  private mapStatus(raw: unknown): FakeGatewayWebhookStatus | null {
    const VALID: FakeGatewayWebhookStatus[] = [
      'succeeded',
      'failed',
      'cancelled',
      'expired',
      'ignored',
      'pending',
    ];
    if (typeof raw !== 'string') return null;
    return VALID.includes(raw as FakeGatewayWebhookStatus)
      ? (raw as FakeGatewayWebhookStatus)
      : null;
  }
}
