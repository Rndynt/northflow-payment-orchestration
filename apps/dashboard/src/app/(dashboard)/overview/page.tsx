"use client";

import { useEffect, useState } from "react";
import { getClient, formatDate } from "@/lib/sdk";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IntentStatusBadge, TransactionStatusBadge } from "@/components/shared/status-badge";
import { AmountDisplay } from "@/components/shared/amount-display";
import { CopyId } from "@/components/shared/copy-id";
import { Skeleton } from "@/components/ui/skeleton";

interface ServiceStatus {
  ok: boolean;
  service: string;
  providers: Record<string, { registered: boolean; configured?: boolean }>;
  database: string;
}

export default function OverviewPage() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const client = getClient();
        const readiness = await client.getReadiness();
        setStatus(readiness as any);
      } catch {
        setStatus(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const providerEntries = status ? Object.entries(status.providers) : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Service Status"
          value={loading ? "—" : status?.ok ? "Online" : "Offline"}
          sub={loading ? "" : status?.service ?? ""}
          loading={loading}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
        />
        <StatCard
          label="Database"
          value={loading ? "—" : status?.database === "configured" ? "Connected" : "Not configured"}
          loading={loading}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          }
        />
        <StatCard
          label="Providers"
          value={loading ? "—" : providerEntries.filter(([, v]) => v.registered).length}
          sub="registered"
          loading={loading}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
        />
        <StatCard
          label="Version"
          value={loading ? "—" : status?.service ?? "—"}
          sub="Phase 8K"
          loading={loading}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Payment Providers</CardTitle>
          </CardHeader>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          ) : providerEntries.length === 0 ? (
            <p className="text-sm text-zinc-600">No providers registered.</p>
          ) : (
            <div className="space-y-2">
              {providerEntries.map(([name, info]) => (
                <div key={name} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                  <div>
                    <p className="text-sm text-zinc-200 font-medium capitalize">{name.replace(/_/g, " ")}</p>
                    {info.configured !== undefined && (
                      <p className="text-xs text-zinc-600 mt-0.5">{info.configured ? "Configured" : "Not configured"}</p>
                    )}
                  </div>
                  <Badge variant={info.registered ? "success" : "neutral"} dot>
                    {info.registered ? "Registered" : "Inactive"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {[
              { href: "/merchants", label: "Manage Merchants", desc: "Create and view merchant accounts" },
              { href: "/intents", label: "Payment Intents", desc: "Monitor and manage payment flows" },
              { href: "/transactions", label: "Transactions", desc: "View all payment, refund, and void records" },
              { href: "/events", label: "Provider Events", desc: "Webhook audit log and reprocessing" },
              { href: "/devtools", label: "Dev Tools", desc: "FakeGateway simulator and worker triggers" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-zinc-800/50 transition-colors group"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100">{item.label}</p>
                  <p className="text-xs text-zinc-600 mt-0.5">{item.desc}</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-zinc-700 group-hover:text-zinc-500 shrink-0">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </a>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
