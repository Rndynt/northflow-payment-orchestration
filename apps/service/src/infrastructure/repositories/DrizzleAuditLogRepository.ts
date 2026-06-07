/**
 * DrizzleAuditLogRepository — S8: Drizzle-backed audit log persistence.
 *
 * Audit logs are immutable: only `create` and `list` are supported.
 * No update. No delete (audit rows must persist even after merchant/client deletion).
 *
 * No FK constraints on merchant_id/client_id: we rely on soft references so
 * audit rows survive the deletion of the entity they reference.
 */

import { desc, eq, and, sql } from 'drizzle-orm';
import type { PoDb } from '../db.ts';
import { poAuditLogs } from '../schema.ts';
import type {
  AuditLogRepository,
  CreateAuditLogInput,
  ListAuditLogsInput,
} from '@northflow/payment-orchestration-core';
import type { AuditLog } from '@northflow/payment-orchestration-core';

export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: PoDb) {}

  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const [row] = await this.db
      .insert(poAuditLogs)
      .values({
        id: input.id,
        requestId: input.requestId,
        clientId: input.clientId,
        sourceApp: input.sourceApp,
        merchantId: input.merchantId,
        actorType: input.actorType,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        status: input.status,
        httpMethod: input.httpMethod,
        path: input.path,
        statusCode: input.statusCode,
        errorCode: input.errorCode,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata,
      })
      .returning();

    return this.toDTO(row);
  }

  async list(input: ListAuditLogsInput): Promise<{ entries: AuditLog[]; total: number }> {
    const limit = Math.min(input.limit ?? 50, 200);
    const offset = input.offset ?? 0;

    const conditions = [];
    if (input.merchantId) conditions.push(eq(poAuditLogs.merchantId, input.merchantId));
    if (input.clientId) conditions.push(eq(poAuditLogs.clientId, input.clientId));
    if (input.action) conditions.push(eq(poAuditLogs.action, input.action));
    if (input.status) conditions.push(eq(poAuditLogs.status, input.status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(poAuditLogs)
        .where(where),
      this.db
        .select()
        .from(poAuditLogs)
        .where(where)
        .orderBy(desc(poAuditLogs.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      entries: rows.map((r) => this.toDTO(r)),
      total: countResult[0]?.count ?? 0,
    };
  }

  private toDTO(row: typeof poAuditLogs.$inferSelect): AuditLog {
    return {
      id: row.id,
      requestId: row.requestId,
      clientId: row.clientId,
      sourceApp: row.sourceApp,
      merchantId: row.merchantId,
      actorType: row.actorType as AuditLog['actorType'],
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      status: row.status as AuditLog['status'],
      httpMethod: row.httpMethod,
      path: row.path,
      statusCode: row.statusCode,
      errorCode: row.errorCode,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.createdAt,
    };
  }
}
