"use client";

import { Badge } from "@/components/ui/badge";
import {
  getIntentStatus,
  getTransactionStatus,
  getProviderEventStatus,
} from "@/lib/status";

export function IntentStatusBadge({ status }: { status: string }) {
  const { label, variant } = getIntentStatus(status);
  return <Badge variant={variant} dot>{label}</Badge>;
}

export function TransactionStatusBadge({ status }: { status: string }) {
  const { label, variant } = getTransactionStatus(status);
  return <Badge variant={variant} dot>{label}</Badge>;
}

export function ProviderEventStatusBadge({ status }: { status: string }) {
  const { label, variant } = getProviderEventStatus(status);
  return <Badge variant={variant} dot>{label}</Badge>;
}
