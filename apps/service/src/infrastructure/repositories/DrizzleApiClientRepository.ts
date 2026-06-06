/**
 * DrizzleApiClientRepository — S1: API client CRUD via Drizzle ORM.
 */

import { eq } from 'drizzle-orm';
import type { PoDb } from '../db.ts';
import { poApiClients } from '../schema.ts';
import type { ApiClientRepository, CreateApiClientInput } from '@northflow/payment-orchestration-core';
import type { ApiClientDTO, ApiClientStatus } from '@northflow/payment-orchestration-core';

export class DrizzleApiClientRepository implements ApiClientRepository {
  constructor(private readonly db: PoDb) {}

  async findById(id: string): Promise<ApiClientDTO | null> {
    const rows = await this.db
      .select()
      .from(poApiClients)
      .where(eq(poApiClients.id, id))
      .limit(1);
    return rows[0] ? this.#map(rows[0]) : null;
  }

  async create(input: CreateApiClientInput): Promise<ApiClientDTO> {
    const rows = await this.db
      .insert(poApiClients)
      .values({
        id: input.id,
        name: input.name,
        sourceApp: input.sourceApp,
        environment: input.environment,
        status: input.status ?? 'active',
        scopes: input.scopes ?? [],
        metadata: input.metadata ?? {},
      })
      .returning();
    return this.#map(rows[0]);
  }

  async updateStatus(id: string, status: ApiClientStatus): Promise<ApiClientDTO> {
    const rows = await this.db
      .update(poApiClients)
      .set({ status, updatedAt: new Date() })
      .where(eq(poApiClients.id, id))
      .returning();
    if (!rows[0]) throw new Error(`ApiClient not found: ${id}`);
    return this.#map(rows[0]);
  }

  #map(row: typeof poApiClients.$inferSelect): ApiClientDTO {
    return {
      id: row.id,
      name: row.name,
      sourceApp: row.sourceApp,
      environment: row.environment,
      status: row.status as ApiClientStatus,
      scopes: (row.scopes ?? []) as string[],
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
