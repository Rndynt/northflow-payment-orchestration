import type { IntentStatus, TransactionStatus } from "@/types";

export type StatusVariant = "success" | "warning" | "danger" | "info" | "neutral" | "pending";

export interface StatusConfig {
  label: string;
  variant: StatusVariant;
}

export const INTENT_STATUS_MAP: Record<string, StatusConfig> = {
  requires_payment: { label: "Requires Payment", variant: "pending" },
  partially_paid:   { label: "Partially Paid",   variant: "warning" },
  paid:             { label: "Paid",              variant: "success" },
  overpaid:         { label: "Overpaid",          variant: "warning" },
  refunded:         { label: "Refunded",          variant: "info" },
  voided:           { label: "Voided",            variant: "neutral" },
  expired:          { label: "Expired",           variant: "neutral" },
  cancelled:        { label: "Cancelled",         variant: "neutral" },
  failed:           { label: "Failed",            variant: "danger" },
};

export const TRANSACTION_STATUS_MAP: Record<string, StatusConfig> = {
  pending:          { label: "Pending",           variant: "pending" },
  requires_action:  { label: "Requires Action",   variant: "warning" },
  succeeded:        { label: "Succeeded",         variant: "success" },
  failed:           { label: "Failed",            variant: "danger" },
  cancelled:        { label: "Cancelled",         variant: "neutral" },
  expired:          { label: "Expired",           variant: "neutral" },
  voided:           { label: "Voided",            variant: "neutral" },
  refunded:         { label: "Refunded",          variant: "info" },
  reversed:         { label: "Reversed",          variant: "info" },
  ignored:          { label: "Ignored",           variant: "neutral" },
};

export const PROVIDER_EVENT_STATUS_MAP: Record<string, StatusConfig> = {
  pending:   { label: "Pending",   variant: "pending" },
  processed: { label: "Processed", variant: "success" },
  failed:    { label: "Failed",    variant: "danger" },
  skipped:   { label: "Skipped",   variant: "neutral" },
};

export function getIntentStatus(status: string): StatusConfig {
  return INTENT_STATUS_MAP[status] ?? { label: status, variant: "neutral" };
}

export function getTransactionStatus(status: string): StatusConfig {
  return TRANSACTION_STATUS_MAP[status] ?? { label: status, variant: "neutral" };
}

export function getProviderEventStatus(status: string): StatusConfig {
  return PROVIDER_EVENT_STATUS_MAP[status] ?? { label: status, variant: "neutral" };
}

export const PROVIDER_LABELS: Record<string, string> = {
  fake_gateway:   "FakeGateway",
  xendit_sandbox: "Xendit Sandbox",
  manual:         "Manual",
};

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
