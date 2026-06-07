/**
 * SyncProviderAccountMethods — S7.5: sync provider adapter capabilities into po_provider_account_methods.
 *
 * Layer 1: static adapter capabilities (getPaymentMethodCapabilities)
 * Layer 2: optional provider-side sync hook (syncProviderAccountMethods on adapter)
 *
 * Rules:
 * - Sync is idempotent — running twice produces the same result.
 * - Manual disabled rows are preserved (status not overridden to active).
 * - Unavailable methods (from adapter) are upserted as 'unsupported' only if
 *   the adapter explicitly excludes them from its capability list.
 * - Does not delete existing rows.
 */

import { randomUUID } from 'crypto';
import type { PaymentProviderAccountRepository, ProviderAccountPaymentMethodRepository } from '@northflow/payment-orchestration-core';
import type { ProviderAccountPaymentMethod, ProviderPaymentMethodCapability } from '@northflow/payment-orchestration-core';
import type { ProviderRegistry } from '../../infrastructure/providers/providerRegistry.ts';

export interface SyncProviderAccountMethodsInput {
  merchantId: string;
  providerAccountId: string;
}

export interface SyncProviderAccountMethodsOutput {
  methods: ProviderAccountPaymentMethod[];
  syncedCount: number;
  skippedCount: number;
  message: string;
}

export class SyncProviderAccountMethods {
  constructor(
    private readonly providerAccountRepo: PaymentProviderAccountRepository,
    private readonly methodRepo: ProviderAccountPaymentMethodRepository,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async execute(input: SyncProviderAccountMethodsInput): Promise<SyncProviderAccountMethodsOutput> {
    if (!input.merchantId || !input.providerAccountId) {
      throw Object.assign(
        new Error('merchantId and providerAccountId are required'),
        { statusCode: 400, code: 'VALIDATION_ERROR' },
      );
    }

    const pa = await this.providerAccountRepo.findById(input.providerAccountId, input.merchantId);
    if (!pa) {
      throw Object.assign(
        new Error(`Provider account not found: ${input.providerAccountId}`),
        { statusCode: 404, code: 'PROVIDER_ACCOUNT_NOT_FOUND' },
      );
    }

    const adapter = this.providerRegistry.get(pa.provider);
    if (!adapter) {
      throw Object.assign(
        new Error(`Provider adapter not available: ${pa.provider}`),
        { statusCode: 422, code: 'PROVIDER_NOT_AVAILABLE' },
      );
    }

    // Layer 1: static adapter capabilities
    let capabilities: ProviderPaymentMethodCapability[] = [];
    if (typeof (adapter as any).getPaymentMethodCapabilities === 'function') {
      capabilities = (adapter as any).getPaymentMethodCapabilities() as ProviderPaymentMethodCapability[];
    }

    // Layer 2: optional provider sync hook (live provider API call)
    if (typeof (adapter as any).syncProviderAccountMethods === 'function') {
      try {
        const live = await (adapter as any).syncProviderAccountMethods(pa) as ProviderPaymentMethodCapability[];
        if (Array.isArray(live) && live.length > 0) {
          capabilities = live;
        }
      } catch {
        // Fall through to static capabilities
      }
    }

    if (capabilities.length === 0) {
      const existing = await this.methodRepo.listByProviderAccount(input.providerAccountId);
      return {
        methods: existing,
        syncedCount: 0,
        skippedCount: existing.length,
        message: 'No capabilities declared by adapter; no changes made.',
      };
    }

    // Fetch existing methods to preserve manual disabled status
    const existingMethods = await this.methodRepo.listByProviderAccount(input.providerAccountId);
    const existingByMethod = new Map(existingMethods.map((m) => [m.method, m]));

    let syncedCount = 0;
    for (const cap of capabilities) {
      const existing = existingByMethod.get(cap.method);

      // Preserve manually-disabled status — do not re-enable
      const statusToSet = existing?.status === 'disabled' ? 'disabled' : 'active';

      await this.methodRepo.upsert({
        id: existing?.id ?? `pam_${randomUUID()}`,
        merchantId: input.merchantId,
        providerAccountId: input.providerAccountId,
        provider: pa.provider,
        method: cap.method,
        methodType: cap.methodType,
        providerMethodCode: cap.providerSpecificCode ?? null,
        displayName: cap.displayName,
        status: statusToSet,
        currency: cap.supportedCurrencies[0] ?? 'IDR',
        minAmount: cap.minAmount ?? null,
        maxAmount: cap.maxAmount ?? null,
        sortOrder: 0,
        publicConfig: {},
        providerMetadata: cap.metadata ?? {},
        metadata: {},
      });
      syncedCount++;
    }

    const updated = await this.methodRepo.listByProviderAccount(input.providerAccountId);
    return {
      methods: updated,
      syncedCount,
      skippedCount: existingMethods.length - syncedCount < 0 ? 0 : existingMethods.length - syncedCount,
      message: `Synced ${syncedCount} method(s) from adapter capabilities.`,
    };
  }
}
