export type IntentStatus =
  | "requires_payment"
  | "partially_paid"
  | "paid"
  | "overpaid"
  | "refunded"
  | "voided"
  | "expired"
  | "cancelled"
  | "failed";

export type TransactionStatus =
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "voided"
  | "refunded"
  | "reversed"
  | "ignored";

export type TransactionType = "payment" | "refund" | "void" | "manual";
export type TransactionDirection = "incoming" | "outgoing";

export type ProviderEventStatus = "pending" | "processed" | "failed" | "skipped";

export interface DashboardConfig {
  serviceUrl: string;
  serviceToken: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number | string;
}
