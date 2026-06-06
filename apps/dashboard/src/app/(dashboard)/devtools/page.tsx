"use client";

import { useState } from "react";
import { getClient } from "@/lib/sdk";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";

export default function DevToolsPage() {
  const { toasts, toast, dismiss } = useToast();

  const [confirmTxId, setConfirmTxId] = useState("");
  const [confirmMerchantId, setConfirmMerchantId] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmResult, setConfirmResult] = useState<any>(null);

  const [refreshTxId, setRefreshTxId] = useState("");
  const [refreshMerchantId, setRefreshMerchantId] = useState("");
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshResult, setRefreshResult] = useState<any>(null);

  const [reconcileIntentId, setReconcileIntentId] = useState("");
  const [reconcileMerchantId, setReconcileMerchantId] = useState("");
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<any>(null);

  const handleConfirm = async () => {
    if (!confirmTxId.trim()) return;
    setConfirmLoading(true);
    setConfirmResult(null);
    try {
      const client = getClient();
      const result = await client.confirmFakeGatewayPayment(confirmTxId.trim(), {
        merchantId: confirmMerchantId.trim() || undefined,
      });
      setConfirmResult(result);
      toast("FakeGateway payment confirmed", "success");
    } catch (e: any) {
      toast(e?.message ?? "Confirmation failed", "error");
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleRefreshProvider = async () => {
    if (!refreshTxId.trim()) return;
    setRefreshLoading(true);
    setRefreshResult(null);
    try {
      const client = getClient();
      const result = await client.refreshProviderStatus(refreshTxId.trim(), {
        merchantId: refreshMerchantId.trim() || undefined,
      });
      setRefreshResult(result);
      toast(`Status: ${result.transaction.status}${result.changed ? " (changed)" : " (no change)"}`, result.changed ? "success" : "info");
    } catch (e: any) {
      toast(e?.message ?? "Refresh failed", "error");
    } finally {
      setRefreshLoading(false);
    }
  };

  const handleReconcile = async () => {
    if (!reconcileIntentId.trim()) return;
    setReconcileLoading(true);
    setReconcileResult(null);
    try {
      const client = getClient();
      const result = await client.reconcilePaymentIntentTotals(reconcileIntentId.trim(), {
        merchantId: reconcileMerchantId.trim() || undefined,
      });
      setReconcileResult(result);
      toast(result.changed ? "Reconciliation corrected drift" : "No drift found", result.changed ? "success" : "info");
    } catch (e: any) {
      toast(e?.message ?? "Reconcile failed", "error");
    } finally {
      setReconcileLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Dev Tools"
        description="FakeGateway simulator, provider status refresh, and worker tools"
        action={
          <Badge variant="warning" dot>Development only</Badge>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>FakeGateway Confirm</CardTitle>
              <CardDescription className="mt-0.5">Manually confirm a pending FakeGateway transaction</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            <Input label="Transaction ID *" value={confirmTxId} onChange={(e) => setConfirmTxId(e.target.value)} placeholder="txn_…" onKeyDown={(e) => e.key === "Enter" && handleConfirm()} />
            <Input label="Merchant ID" value={confirmMerchantId} onChange={(e) => setConfirmMerchantId(e.target.value)} placeholder="optional" />
            <Button variant="success" onClick={handleConfirm} loading={confirmLoading} className="w-full">
              Confirm Payment
            </Button>
            {confirmResult && (
              <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3 mt-2">
                <p className="text-xs text-zinc-400 font-medium mb-2">Result</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">Status</span>
                    <span className="text-zinc-300">{confirmResult.transaction?.status}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">Already confirmed</span>
                    <span className="text-zinc-300">{confirmResult.alreadyConfirmed ? "Yes" : "No"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">Intent status</span>
                    <span className="text-zinc-300">{confirmResult.intent?.status}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Refresh Provider Status</CardTitle>
              <CardDescription className="mt-0.5">Poll provider for real-time transaction status</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            <Input label="Transaction ID *" value={refreshTxId} onChange={(e) => setRefreshTxId(e.target.value)} placeholder="txn_…" onKeyDown={(e) => e.key === "Enter" && handleRefreshProvider()} />
            <Input label="Merchant ID" value={refreshMerchantId} onChange={(e) => setRefreshMerchantId(e.target.value)} placeholder="optional" />
            <Button variant="outline" onClick={handleRefreshProvider} loading={refreshLoading} className="w-full">
              Refresh Status
            </Button>
            {refreshResult && (
              <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3 mt-2">
                <p className="text-xs text-zinc-400 font-medium mb-2">Result</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">TX Status</span>
                    <span className="text-zinc-300">{refreshResult.transaction?.status}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">Provider Status</span>
                    <span className="text-zinc-300">{refreshResult.providerStatus}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">Changed</span>
                    <span className={refreshResult.changed ? "text-green-400" : "text-zinc-500"}>
                      {refreshResult.changed ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Force Reconcile Intent</CardTitle>
              <CardDescription className="mt-0.5">Recompute intent totals from transaction source of truth</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            <Input label="Intent ID *" value={reconcileIntentId} onChange={(e) => setReconcileIntentId(e.target.value)} placeholder="pi_…" onKeyDown={(e) => e.key === "Enter" && handleReconcile()} />
            <Input label="Merchant ID" value={reconcileMerchantId} onChange={(e) => setReconcileMerchantId(e.target.value)} placeholder="optional" />
            <Button variant="outline" onClick={handleReconcile} loading={reconcileLoading} className="w-full">
              Run Reconcile
            </Button>
            {reconcileResult && (
              <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3 mt-2">
                <p className="text-xs text-zinc-400 font-medium mb-2">Result</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">Changed</span>
                    <span className={reconcileResult.changed ? "text-amber-400" : "text-green-500"}>
                      {reconcileResult.changed ? "Drift corrected" : "No drift"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">Intent status</span>
                    <span className="text-zinc-300">{reconcileResult.intent?.status}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Service Readiness</CardTitle>
              <CardDescription className="mt-0.5">Check live service health and configuration</CardDescription>
            </div>
          </CardHeader>
          <ReadinessCheck />
        </Card>
      </div>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}

function ReadinessCheck() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const check = async () => {
    setLoading(true);
    setError("");
    try {
      const client = getClient();
      const r = await client.getReadiness();
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={check} loading={loading} className="w-full">
        Check Readiness
      </Button>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {result && (
        <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-600">Service</span>
              <span className="text-zinc-300">{result.service}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-600">Database</span>
              <Badge variant={result.database === "configured" ? "success" : "danger"} dot>{result.database}</Badge>
            </div>
            {Object.entries(result.providers ?? {}).map(([name, info]: [string, any]) => (
              <div key={name} className="flex justify-between text-xs">
                <span className="text-zinc-600 capitalize">{name.replace(/_/g, " ")}</span>
                <Badge variant={info.registered ? "success" : "neutral"} dot>{info.registered ? "registered" : "inactive"}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
