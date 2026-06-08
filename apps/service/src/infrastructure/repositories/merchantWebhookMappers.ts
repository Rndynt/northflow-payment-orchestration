import type {
  MerchantWebhookEndpointDTO,
  MerchantWebhookEventDTO,
  MerchantWebhookDeliveryDTO,
  MerchantWebhookEventType,
  MerchantWebhookPayloadEnvelope,
  MerchantWebhookResourceType,
  MerchantWebhookEndpointStatus,
  MerchantWebhookDeliveryStatus,
} from '@northflow/payment-orchestration-core';

export function mapWebhookEndpointRow(row: any): MerchantWebhookEndpointDTO {
  return {
    id: row.id,
    merchantId: row.merchantId,
    url: row.url,
    status: row.status as MerchantWebhookEndpointStatus,
    subscribedEvents: (row.subscribedEvents ?? []) as MerchantWebhookEventType[],
    secretHash: row.secretHash,
    secretPrefix: row.secretPrefix,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    disabledAt: row.disabledAt ?? null,
  };
}

export function mapWebhookEventRow(row: any): MerchantWebhookEventDTO {
  return {
    id: row.id,
    merchantId: row.merchantId,
    eventType: row.eventType as MerchantWebhookEventType,
    resourceType: row.resourceType as MerchantWebhookResourceType,
    resourceId: row.resourceId,
    payload: row.payload as MerchantWebhookPayloadEnvelope,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt,
  };
}

export function mapWebhookDeliveryRow(row: any): MerchantWebhookDeliveryDTO {
  return {
    id: row.id,
    eventId: row.eventId,
    endpointId: row.endpointId,
    merchantId: row.merchantId,
    status: row.status as MerchantWebhookDeliveryStatus,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt,
    lastAttemptAt: row.lastAttemptAt ?? null,
    lastResponseStatus: row.lastResponseStatus ?? null,
    lastResponseBodyTruncated: row.lastResponseBodyTruncated ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveredAt: row.deliveredAt ?? null,
  };
}
