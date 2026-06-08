import type { PaymentIntentDTO } from './PaymentIntent';
import type { PaymentTransactionDTO } from './PaymentTransaction';

export type MerchantWebhookEndpointStatus = 'active' | 'disabled';
export type MerchantWebhookDeliveryStatus = 'queued' | 'delivering' | 'succeeded' | 'failed' | 'dead';

export type MerchantWebhookEventType =
  | 'payment_intent.requires_payment'
  | 'payment_intent.partially_paid'
  | 'payment_intent.paid'
  | 'payment_intent.failed'
  | 'payment_intent.expired'
  | 'payment_intent.cancelled'
  | 'payment_intent.refunded'
  | 'payment_intent.voided'
  | 'payment_transaction.requires_action'
  | 'payment_transaction.succeeded'
  | 'payment_transaction.failed'
  | 'payment_transaction.cancelled'
  | 'payment_transaction.refunded'
  | 'payment_transaction.voided';

export type MerchantWebhookResourceType = 'payment_intent' | 'payment_transaction';

export interface MerchantWebhookEndpointDTO {
  id: string;
  merchantId: string;
  url: string;
  status: MerchantWebhookEndpointStatus;
  subscribedEvents: MerchantWebhookEventType[];
  secretHash: string;
  secretPrefix: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

export interface MerchantWebhookPayloadEnvelope {
  id: string;
  type: MerchantWebhookEventType;
  createdAt: string;
  merchantId: string;
  resource: {
    type: MerchantWebhookResourceType;
    id: string;
  };
  data: {
    intent: PaymentIntentDTO | null;
    transaction: PaymentTransactionDTO | null;
  };
}

export interface MerchantWebhookEventDTO {
  id: string;
  merchantId: string;
  eventType: MerchantWebhookEventType;
  resourceType: MerchantWebhookResourceType;
  resourceId: string;
  payload: MerchantWebhookPayloadEnvelope;
  dedupeKey: string;
  createdAt: Date;
}

export interface MerchantWebhookDeliveryDTO {
  id: string;
  eventId: string;
  endpointId: string;
  merchantId: string;
  status: MerchantWebhookDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  lastResponseStatus: number | null;
  lastResponseBodyTruncated: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt: Date | null;
}
