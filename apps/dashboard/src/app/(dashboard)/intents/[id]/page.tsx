"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getClient, formatDate, formatCurrency } from "@/lib/sdk";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/shared/copy-id";
import { IntentStatusBadge, TransactionStatusBadge } from "@/components/shared/status-badge";
import { AmountDisplay, IntentAmounts } from "@/components/shared/amount-display";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";
import { getProviderLabel } from "@/lib/status";
import type {
  PaymentIntentStatusResponse,
  RefundabilityResponse,
  ReconcilePaymentIntentTotalsResponse,
} from "@northflow/payment-orchestration-client-sdk";

export default function IntentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const merchantId = searchParams.get("merchantId") ?? undefined;
  const { toasts, toast, dismiss } = useToast();

  const [status, setStatus] = useState<PaymentIntentStatusResponse | null>(null);
  const [refundability, setRefundability] = useState<RefundabilityResponse | null>(null);
  const [reconcileResult, setReconcileResult] = useState<ReconcilePaymentIntentTotalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGatewayPayment, setShowGatewayPayment] = useState(false);
  const [showReconcile, setShowReconcile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reconcilingLoading, setReconcilingLoading] = useState(false);
  const [payForm, setPayForm] = useState({ provider: "fake_gateway", method: "qris", amount: "" });
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const client = getClient();
      const [statusRes, refundRes] = await Promise.allSettled([
        client.getPaymentIntentStatus(id, { merchantId }),
        client.getRefundability(id, { merchantId }),
      ]);
      if (statusRes.status === "fulfilled") setStatus(statusRes.value);
      if (refundRes.status === "fulfilled") setRefundability(refundRes.value);
    } catch {
      setStatus(null);
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

  const handleReconcile = async () => {
    setReconcilingLoading(true);
    try {
      const client = getClient();
      const result = await client.reconcilePaymentIntentTotals(id, { merchantId });
      setReconcileResult(result);
      setShowReconcile(true);
      await load();
    } catch (e: any) {
      toast(e?.message ?? "Reconciliation failed", "error");
    } finally {
      setReconcilingLoading(false);
    }
  };

  const handleCreateGatewayPayment = async () => {
    if (!payForm.amount) { setPayError("Amount is required."); return; }
    setPayError("");
    setPayLoading(true);
    try {
      const client = getClient();
      const result = await client.createGatewayPayment(id, {
        merchantId,
        provider: payForm.provider,
        method: payForm.method,
        amount: parseInt(payForm.amount, 10),
      });
      setShowGatewayPayment(false);
      setPayForm({ provider: "fake_gateway", method: "qris", amount: "" });
      toast("Gateway payment created", "success");
      await load();
    } catch (e: any) {
      setPayError(e?.message ?? "Failed to create payment");
    } finally {
      setPayLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-zinc-500">Intent not found or access denied.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push("/intents")}>Back</Button>
      </div>
    );
  }

  const intent = status.intent;

  return (
    <>
      <div className="mb-5">
        <button onClick={() => router.push("/intents")} className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors mb-4">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          Payment Intents
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CopyId id={intent.id} truncate={16} />
              <IntentStatusBadge status={intent.status} />
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              {intent.externalPayableType} / {intent.externalPayableId}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleRefresh} loading={refreshing}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReconcile} loading={reconcilingLoading}>
              Reconcile
            </Button>
            {status.canRetryPayment && (
              <Button size="sm" onClick={() => setShowGatewayPayment(true)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                Pay
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Amount Breakdown</CardTitle></CardHeader>
          <IntentAmounts
            amountDue={intent.amountDue}
            amountPaid={intent.amountPaid}
            amountRefunded={intent.amountRefunded}
            amountRemaining={intent.amountRemaining}
            currency={intent.currency}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-zinc-800">
            {[
              { label: "Due", amount: intent.amountDue },
              { label: "Paid", amount: intent.amountPaid, positive: true },
              { label: "Refunded", amount: intent.amountRefunded },
              { label: "Remaining", amount: intent.amountRemaining },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-xs text-zinc-600 mb-1">{item.label}</p>
                <AmountDisplay amount={item.amount} currency={intent.currency} positive={item.positive} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>State</CardTitle></CardHeader>
          <div className="space-y-3">
            {[
              { label: "Status", value: <IntentStatusBadge status={intent.status} /> },
              { label: "Terminal", value: <Badge variant={status.isTerminal ? "neutral" : "pending"}>{status.isTerminal ? "Yes" : "No"}</Badge> },
              { label: "Req. Action", value: <Badge variant={status.requiresAction ? "warning" : "neutral"}>{status.requiresAction ? "Yes" : "No"}</Badge> },
              { label: "Can Retry", value: <Badge variant={status.canRetryPayment ? "success" : "neutral"}>{status.canRetryPayment ? "Yes" : "No"}</Badge> },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-zinc-800/40 last:border-0">
                <span className="text-xs text-zinc-500">{item.label}</span>
                <span>{item.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {refundability && refundability.totalRefundable > 0 && (
        <Card className="mb-4">
          <CardHeader><CardTitle>Refundability</CardTitle></CardHeader>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-zinc-400">Total refundable</p>
            <AmountDisplay amount={refundability.totalRefundable} currency={refundability.currency} size="lg" positive />
          </div>
          {refundability.transactions.map((t) => (
            <div key={t.transactionId} className="flex items-center justify-between py-2 border-t border-zinc-800/40 text-xs">
              <div>
                <CopyId id={t.transactionId} truncate={10} />
                <p className="text-zinc-600 mt-0.5">{getProviderLabel(t.provider)} · {t.method}</p>
              </div>
              <div className="text-right">
                <p className="text-zinc-300">{formatCurrency(t.amountRefundable, refundability.currency)}</p>
                {t.amountAlreadyRefunded > 0 && (
                  <p className="text-zinc-600 mt-0.5">{formatCurrency(t.amountAlreadyRefunded, refundability.currency)} refunded</p>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {status.latestTransaction && (
        <Card>
          <CardHeader><CardTitle>Latest Transaction</CardTitle></CardHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "ID", value: <CopyId id={status.latestTransaction.id} truncate={12} /> },
              { label: "Status", value: <TransactionStatusBadge status={status.latestTransaction.status} /> },
              { label: "Provider", value: getProviderLabel(status.latestTransaction.provider) },
              { label: "Method", value: status.latestTransaction.method },
              { label: "Amount", value: <AmountDisplay amount={status.latestTransaction.amount} currency={status.latestTransaction.currency} /> },
              { label: "Updated", value: <span className="text-xs text-zinc-600">{formatDate(status.latestTransaction.updatedAt)}</span> },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs text-zinc-600 mb-1">{item.label}</p>
                <div className="text-sm text-zinc-300">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/transactions/${status.latestTransaction!.id}?merchantId=${intent.merchantId}`)}
            >
              View Full Transaction →
            </Button>
          </div>
        </Card>
      )}

      <Dialog open={showGatewayPayment} onClose={() => { setShowGatewayPayment(false); setPayError(""); }} title="Create Gateway Payment" description={`Initiate a payment for intent ${id.slice(0, 8)}…`}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Provider</label>
            <select value={payForm.provider} onChange={(e) => setPayForm({ ...payForm, provider: e.target.value })} className="h-9 w-full rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 px-3 focus:outline-none focus:border-zinc-600">
              <option value="fake_gateway">FakeGateway</option>
              <option value="xendit_sandbox">Xendit Sandbox</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <Input label="Method" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} placeholder="qris, va, card…" />
          <Input label="Amount *" type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder={String(intent.amountRemaining)} />
          {payError && <p className="text-xs text-red-500">{payError}</p>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={handleCreateGatewayPayment} loading={payLoading}>Create Payment</Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowGatewayPayment(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={showReconcile} onClose={() => setShowReconcile(false)} title="Reconciliation Result">
        {reconcileResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={reconcileResult.changed ? "warning" : "success"} dot>
                {reconcileResult.changed ? "Drift corrected" : "No drift found"}
              </Badge>
            </div>
            {reconcileResult.changed && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-zinc-500 mb-2 font-medium">Before</p>
                  {Object.entries(reconcileResult.before).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs py-1">
                      <span className="text-zinc-600">{k}</span>
                      <span className="text-zinc-400 tabular-nums">{typeof v === "number" ? formatCurrency(v, intent.currency) : String(v)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-2 font-medium">After</p>
                  {Object.entries(reconcileResult.after).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs py-1">
                      <span className="text-zinc-600">{k}</span>
                      <span className="text-zinc-200 tabular-nums font-medium">{typeof v === "number" ? formatCurrency(v, intent.currency) : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Button className="w-full" onClick={() => setShowReconcile(false)}>Close</Button>
          </div>
        )}
      </Dialog>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}
