"use client";

import { PaymentOrchestrationClient } from "@northflow/payment-orchestration-client-sdk";

let _client: PaymentOrchestrationClient | null = null;

export function getClient(): PaymentOrchestrationClient {
  if (!_client) {
    _client = new PaymentOrchestrationClient({
      baseUrl: "/api/proxy",
      serviceToken: "proxy-internal",
    });
  }
  return _client;
}

export function resetClient(): void {
  _client = null;
}

export function formatCurrency(amount: number, currency = "IDR"): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}…`;
}
