"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getClient, formatDate } from "@/lib/sdk";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TransactionStatusBadge } from "@/components/shared/status-badge";
import { AmountDisplay } from "@/components/shared/amount-display";
import { CopyId } from "@/components/shared/copy-id";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";
import { getProviderLabel } from "@/lib/status";
import type { PaymentTransactionResponse } from "@northflow/payment-orchestration-client-sdk";

interface TxRow extends PaymentTransactionResponse {
  merchantId: string;
}

export default function TransactionsPage() {
  const router = useRouter();
  const { toasts, toast, dismiss } = useToast();
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [lookupId, setLookupId] = useState("");
  const [lookupMerchantId, setLookupMerchantId] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);

  const handleLookup = useCallback(async () => {
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    try {
      const client = getClient();
      const result = await client.refreshProviderStatus(lookupId.trim(), {
        merchantId: lookupMerchantId.trim() || undefined,
      });
      const tx = { ...result.transaction, merchantId: lookupMerchantId.trim() } as TxRow;
      setTransactions((prev) => {
        const exists = prev.find((x) => x.id === tx.id);
        return exists ? prev.map((x) => x.id === tx.id ? tx : x) : [tx, ...prev];
      });
      setLookupId("");
    } catch (e: any) {
      toast(e?.message ?? "Transaction not found", "error");
    } finally {
      setLookupLoading(false);
    }
  }, [lookupId, lookupMerchantId, toast]);

  const columns: Column<TxRow>[] = [
    {
      key: "id",
      header: "Transaction ID",
      render: (row) => <CopyId id={row.id} truncate={10} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <TransactionStatusBadge status={row.status} />,
    },
    {
      key: "provider",
      header: "Provider",
      render: (row) => (
        <div>
          <p className="text-zinc-300 text-xs font-medium">{getProviderLabel(row.provider)}</p>
          <p className="text-zinc-600 text-xs">{row.method}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => <AmountDisplay amount={row.amount} currency={row.currency} />,
    },
    {
      key: "intent",
      header: "Intent",
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/intents/${row.intentId}?merchantId=${row.merchantId}`); }}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-mono"
        >
          {row.intentId.slice(0, 10)}…
        </button>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      render: (row) => <span className="text-xs text-zinc-600">{formatDate(row.updatedAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "70px",
      align: "right",
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/transactions/${row.id}?merchantId=${row.merchantId}`); }}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Transactions" description="Individual payment, refund, and void records" />

      <Card padding="md" className="mb-4">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">Look up by Transaction ID</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Transaction ID" className="flex-1" onKeyDown={(e) => e.key === "Enter" && handleLookup()} />
          <Input value={lookupMerchantId} onChange={(e) => setLookupMerchantId(e.target.value)} placeholder="Merchant ID (optional)" className="flex-1" onKeyDown={(e) => e.key === "Enter" && handleLookup()} />
          <Button variant="outline" onClick={handleLookup} loading={lookupLoading} className="shrink-0">Lookup</Button>
        </div>
      </Card>

      <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900">
        <DataTable
          columns={columns}
          data={transactions}
          loading={false}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/transactions/${r.id}?merchantId=${r.merchantId}`)}
          emptyTitle="No transactions loaded"
          emptyDescription="Look up a transaction by ID to get started"
        />
      </div>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}
