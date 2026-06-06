"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getClient, formatDate, formatCurrency } from "@/lib/sdk";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/shared/copy-id";
import { TransactionStatusBadge } from "@/components/shared/status-badge";
import { AmountDisplay } from "@/components/shared/amount-display";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";
import { getProviderLabel } from "@/lib/status";
import type { PaymentTransactionResponse } from "@northflow/payment-orchestration-client-sdk";

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const merchantId = searchParams.get("merchantId") ?? undefined;
  const { toasts, toast, dismiss } = useToast();

  const [transaction, setTransaction] = useState<PaymentTransactionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRefund, setShowRefund] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [refundForm, setRefundForm] = useState({ amount: "", reason: "", idempotencyKey: "" });
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState("");

  const [voidLoading, setVoidLoading] = useState(false);
  const [voidError, setVoidError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const client = getClient();
      const result = await client.refreshProviderStatus(id, { merchantId });
      setTransaction(result.transaction);
    } catch {
      setTransaction(null);
    } finally {
      setLoading(false);
    }
  }, [id, merchantId]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
    toast("Status refreshed", "info");
  };

  const handleRefund = async () => {
    if (!refundForm.amount) { setRefundError("Amount is required."); return; }
    setRefundError("");
    setRefundLoading(true);
    try {
      const client = getClient();
      const result = await client.refundPaymentTransaction(id, {
        merchantId,
        amount: parseInt(refundForm.amount, 10),
        reason: refundForm.reason || null,
        idempotencyKey: refundForm.idempotencyKey || null,
      });
      setTransaction(result.refundTransaction);
      setShowRefund(false);
      toast("Refund initiated successfully", "success");
      await load();
    } catch (e: any) {
      setRefundError(e?.message ?? "Refund failed");
    } finally {
      setRefundLoading(false);
    }
  };

  const handleVoid = async () => {
    setVoidError("");
    setVoidLoading(true);
    try {
      const client = getClient();
      const result = await client.voidPaymentTransaction(id, { merchantId });
      if (result.transaction) setTransaction(result.transaction);
      setShowVoid(false);
      toast("Transaction voided", "success");
      await load();
    } catch (e: any) {
      setVoidError(e?.message ?? "Void failed");
    } finally {
      setVoidLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-zinc-500">Transaction not found.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push("/transactions")}>Back</Button>
      </div>
    );
  }

  const canRefund = transaction.status === "succeeded";
  const canVoid = transaction.status === "pending" || transaction.status === "requires_action";

  return (
    <>
      <div className="mb-5">
        <button onClick={() => router.push("/transactions")} className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors mb-4">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          Transactions
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CopyId id={transaction.id} truncate={16} />
              <TransactionStatusBadge status={transaction.status} />
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              {getProviderLabel(transaction.provider)} · {transaction.method}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleRefresh} loading={refreshing}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              Refresh
            </Button>
            {canVoid && (
              <Button variant="outline" size="sm" onClick={() => setShowVoid(true)}>Void</Button>
            )}
            {canRefund && (
              <Button variant="outline" size="sm" onClick={() => setShowRefund(true)}>Refund</Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Transaction Details</CardTitle></CardHeader>
          <dl className="space-y-0">
            {[
              { label: "ID", value: <CopyId id={transaction.id} truncate={24} /> },
              { label: "Intent", value: (
                <button onClick={() => router.push(`/intents/${transaction.intentId}?merchantId=${merchantId ?? ""}`)} className="text-xs text-zinc-400 hover:text-zinc-200 font-mono transition-colors">
                  {transaction.intentId.slice(0, 16)}…
                </button>
              )},
              { label: "Status", value: <TransactionStatusBadge status={transaction.status} /> },
              { label: "Provider", value: getProviderLabel(transaction.provider) },
              { label: "Method", value: transaction.method },
              { label: "Amount", value: <AmountDisplay amount={transaction.amount} currency={transaction.currency} size="lg" /> },
              { label: "Provider Ref", value: transaction.providerReference ? <CopyId id={transaction.providerReference} truncate={20} /> : "—" },
              { label: "Failure", value: transaction.failureReason ? <span className="text-xs text-red-400">{transaction.failureReason}</span> : "—" },
              { label: "Created", value: <span className="text-xs text-zinc-600">{formatDate(transaction.createdAt)}</span> },
              { label: "Updated", value: <span className="text-xs text-zinc-600">{formatDate(transaction.updatedAt)}</span> },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-2.5 border-b border-zinc-800/40 last:border-0">
                <dt className="text-xs text-zinc-500 shrink-0 w-24">{item.label}</dt>
                <dd className="text-sm text-zinc-300 text-right">{item.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="space-y-4">
          {transaction.providerPaymentUrl && (
            <Card>
              <CardHeader><CardTitle>Payment URL</CardTitle></CardHeader>
              <a
                href={transaction.providerPaymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-400 hover:text-zinc-200 break-all transition-colors"
              >
                {transaction.providerPaymentUrl}
              </a>
            </Card>
          )}

          {transaction.providerQrString && (
            <Card>
              <CardHeader><CardTitle>QR String</CardTitle></CardHeader>
              <p className="text-xs font-mono text-zinc-500 break-all">{transaction.providerQrString}</p>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <div className="space-y-2">
              {canRefund ? (
                <Button variant="outline" className="w-full" onClick={() => setShowRefund(true)}>
                  Initiate Refund
                </Button>
              ) : (
                <p className="text-xs text-zinc-600">Refund available for succeeded transactions.</p>
              )}
              {canVoid ? (
                <Button variant="danger" className="w-full" onClick={() => setShowVoid(true)}>
                  Void Transaction
                </Button>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={showRefund} onClose={() => { setShowRefund(false); setRefundError(""); }} title="Initiate Refund" description={`Refund for transaction ${id.slice(0, 8)}…`}>
        <div className="space-y-3">
          <Input label="Amount *" type="number" value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} placeholder={String(transaction.amount)} />
          <Input label="Reason" value={refundForm.reason} onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })} placeholder="optional" />
          <Input label="Idempotency Key" value={refundForm.idempotencyKey} onChange={(e) => setRefundForm({ ...refundForm, idempotencyKey: e.target.value })} placeholder="optional" />
          {refundError && <p className="text-xs text-red-500">{refundError}</p>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={handleRefund} loading={refundLoading}>Confirm Refund</Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowRefund(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={showVoid} onClose={() => { setShowVoid(false); setVoidError(""); }} title="Void Transaction" description="This will cancel the pending transaction with the provider.">
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-950/30 border border-amber-900/40 px-3 py-2.5">
            <p className="text-xs text-amber-400">This action will attempt to cancel the payment with the provider. It cannot be undone.</p>
          </div>
          {voidError && <p className="text-xs text-red-500">{voidError}</p>}
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" onClick={handleVoid} loading={voidLoading}>Confirm Void</Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowVoid(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}
