"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getClient, formatDate } from "@/lib/sdk";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { IntentStatusBadge } from "@/components/shared/status-badge";
import { AmountDisplay } from "@/components/shared/amount-display";
import { CopyId } from "@/components/shared/copy-id";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";
import type { PaymentIntentStatusResponse } from "@northflow/payment-orchestration-client-sdk";

interface IntentRow {
  id: string;
  merchantId: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  currency: string;
  externalPayableType: string;
  externalPayableId: string;
  createdAt: string;
  updatedAt: string;
}

export default function IntentsPage() {
  const router = useRouter();
  const { toasts, toast, dismiss } = useToast();
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lookupId, setLookupId] = useState("");
  const [lookupMerchantId, setLookupMerchantId] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({
    merchantId: "",
    externalPayableType: "order",
    externalPayableId: "",
    currency: "IDR",
    amountDue: "",
    allowPartial: false,
    expiresAt: "",
  });

  const handleLookup = useCallback(async () => {
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    try {
      const client = getClient();
      const result: PaymentIntentStatusResponse = await client.getPaymentIntentStatus(lookupId.trim(), {
        merchantId: lookupMerchantId.trim() || undefined,
      });
      const intent = result.intent;
      setIntents((prev) => {
        const exists = prev.find((x) => x.id === intent.id);
        if (exists) return prev.map((x) => x.id === intent.id ? intent as IntentRow : x);
        return [intent as IntentRow, ...prev];
      });
      setLookupId("");
    } catch (e: any) {
      toast(e?.message ?? "Intent not found", "error");
    } finally {
      setLookupLoading(false);
    }
  }, [lookupId, lookupMerchantId, toast]);

  const handleCreate = async () => {
    if (!form.merchantId.trim() || !form.externalPayableId.trim() || !form.amountDue) {
      setFormError("Merchant ID, Payable ID, and Amount are required.");
      return;
    }
    setFormError("");
    setCreating(true);
    try {
      const client = getClient();
      const intent = await client.createPaymentIntent({
        merchantId: form.merchantId.trim(),
        externalPayableType: form.externalPayableType.trim(),
        externalPayableId: form.externalPayableId.trim(),
        currency: form.currency.trim(),
        amountDue: parseInt(form.amountDue, 10),
        allowPartial: form.allowPartial,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      });
      setIntents((prev) => [intent as IntentRow, ...prev]);
      setShowCreate(false);
      setForm({ merchantId: "", externalPayableType: "order", externalPayableId: "", currency: "IDR", amountDue: "", allowPartial: false, expiresAt: "" });
      toast("Payment intent created", "success");
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to create intent");
    } finally {
      setCreating(false);
    }
  };

  const columns: Column<IntentRow>[] = [
    {
      key: "id",
      header: "Intent ID",
      render: (row) => <CopyId id={row.id} truncate={10} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <IntentStatusBadge status={row.status} />,
    },
    {
      key: "payable",
      header: "Payable",
      render: (row) => (
        <div>
          <p className="text-zinc-300 text-xs">{row.externalPayableType}</p>
          <p className="text-zinc-600 text-xs font-mono">{row.externalPayableId.slice(0, 12)}…</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Due",
      align: "right",
      render: (row) => <AmountDisplay amount={row.amountDue} currency={row.currency} />,
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      render: (row) => <AmountDisplay amount={row.amountPaid} currency={row.currency} positive={row.amountPaid > 0} muted={row.amountPaid === 0} />,
    },
    {
      key: "remaining",
      header: "Remaining",
      align: "right",
      render: (row) => <AmountDisplay amount={row.amountRemaining} currency={row.currency} muted={row.amountRemaining === 0} />,
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
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/intents/${row.id}?merchantId=${row.merchantId}`); }}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Payment Intents"
        description="Track and manage payment orchestration flows"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
              New Intent
            </Button>
          </div>
        }
      />

      <Card padding="md" className="mb-4">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">Look up by Intent ID</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Intent ID" className="flex-1" onKeyDown={(e) => e.key === "Enter" && handleLookup()} />
          <Input value={lookupMerchantId} onChange={(e) => setLookupMerchantId(e.target.value)} placeholder="Merchant ID (optional)" className="flex-1" onKeyDown={(e) => e.key === "Enter" && handleLookup()} />
          <Button variant="outline" onClick={handleLookup} loading={lookupLoading} className="shrink-0">Lookup</Button>
        </div>
      </Card>

      <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900">
        <DataTable
          columns={columns}
          data={intents}
          loading={false}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/intents/${r.id}?merchantId=${r.merchantId}`)}
          emptyTitle="No intents loaded"
          emptyDescription="Look up an intent by ID or create a new one"
        />
      </div>

      <Dialog open={showCreate} onClose={() => { setShowCreate(false); setFormError(""); }} title="New Payment Intent" description="Create a new payment orchestration flow">
        <div className="space-y-3">
          <Input label="Merchant ID *" value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} placeholder="merchant-id" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Payable Type *" value={form.externalPayableType} onChange={(e) => setForm({ ...form, externalPayableType: e.target.value })} placeholder="order" />
            <Input label="Payable ID *" value={form.externalPayableId} onChange={(e) => setForm({ ...form, externalPayableId: e.target.value })} placeholder="order-123" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount (IDR) *" type="number" value={form.amountDue} onChange={(e) => setForm({ ...form, amountDue: e.target.value })} placeholder="50000" />
            <Input label="Currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="IDR" />
          </div>
          <Input label="Expires At" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={form.allowPartial} onChange={(e) => setForm({ ...form, allowPartial: e.target.checked })} className="accent-zinc-400" />
            Allow partial payment
          </label>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={handleCreate} loading={creating}>Create Intent</Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}
