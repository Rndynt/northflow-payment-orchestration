"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getClient } from "@/lib/sdk";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/shared/copy-id";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";
import type { MerchantResponse, ProviderAccountResponse } from "@northflow/payment-orchestration-client-sdk";

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toasts, toast, dismiss } = useToast();
  const [merchant, setMerchant] = useState<MerchantResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [lookupProviderId, setLookupProviderId] = useState("");
  const [provider, setProvider] = useState<ProviderAccountResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    provider: "fake_gateway",
    environment: "sandbox" as "sandbox" | "test" | "production",
    providerAccountRef: "",
    credentialsRef: "",
  });
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const client = getClient();
        const m = await client.getMerchant(id);
        setMerchant(m);
      } catch {
        setMerchant(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleLookupProvider = async () => {
    if (!lookupProviderId.trim()) return;
    try {
      const client = getClient();
      const acc = await client.getProviderAccount(id, lookupProviderId.trim());
      setProvider(acc);
    } catch (e: any) {
      toast(e?.message ?? "Provider account not found", "error");
    }
  };

  const handleCreateProvider = async () => {
    if (!form.provider.trim()) { setFormError("Provider is required."); return; }
    setFormError("");
    setCreating(true);
    try {
      const client = getClient();
      const acc = await client.createProviderAccount(id, {
        provider: form.provider.trim(),
        environment: form.environment,
        providerAccountRef: form.providerAccountRef.trim() || null,
        credentialsRef: form.credentialsRef.trim() || null,
      });
      setProvider(acc);
      setShowAddProvider(false);
      toast("Provider account created", "success");
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to create provider account");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-zinc-500">Merchant not found.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push("/merchants")}>
          Back to Merchants
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-5">
        <button
          onClick={() => router.push("/merchants")}
          className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors mb-4"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
          Merchants
        </button>
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{merchant.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <CopyId id={merchant.id} truncate={16} />
              <Badge variant={merchant.status === "active" ? "success" : "neutral"} dot>
                {merchant.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Merchant Details</CardTitle>
          </CardHeader>
          <dl className="space-y-3">
            {[
              { label: "ID", value: <CopyId id={merchant.id} truncate={24} /> },
              { label: "Name", value: merchant.name },
              { label: "Legal Name", value: merchant.legalName ?? "—" },
              { label: "Status", value: <Badge variant={merchant.status === "active" ? "success" : "neutral"} dot>{merchant.status}</Badge> },
            ].map((item) => (
              <div key={item.label} className="flex items-start justify-between gap-4 py-2 border-b border-zinc-800/50 last:border-0">
                <dt className="text-xs text-zinc-500 shrink-0 w-24">{item.label}</dt>
                <dd className="text-sm text-zinc-300 text-right">{item.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provider Account</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowAddProvider(true)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
              Add
            </Button>
          </CardHeader>

          <div className="flex gap-2 mb-4">
            <Input
              value={lookupProviderId}
              onChange={(e) => setLookupProviderId(e.target.value)}
              placeholder="Provider account ID"
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleLookupProvider()}
            />
            <Button variant="outline" size="md" onClick={handleLookupProvider} className="shrink-0">
              Lookup
            </Button>
          </div>

          {provider ? (
            <dl className="space-y-3 mt-2">
              {[
                { label: "ID", value: <CopyId id={provider.id} truncate={16} /> },
                { label: "Provider", value: provider.provider },
                { label: "Environment", value: <Badge variant={provider.environment === "production" ? "danger" : "info"}>{provider.environment}</Badge> },
                { label: "Account Ref", value: provider.providerAccountRef ?? "—" },
                { label: "Status", value: <Badge variant={provider.status === "active" ? "success" : "neutral"} dot>{provider.status}</Badge> },
              ].map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-4 py-2 border-b border-zinc-800/50 last:border-0">
                  <dt className="text-xs text-zinc-500 shrink-0 w-28">{item.label}</dt>
                  <dd className="text-sm text-zinc-300 text-right">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-zinc-600 text-center py-4">Look up a provider account by ID above</p>
          )}
        </Card>
      </div>

      <Dialog
        open={showAddProvider}
        onClose={() => { setShowAddProvider(false); setFormError(""); }}
        title="Add Provider Account"
        description={`Attach a payment provider to ${merchant.name}`}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Provider *</label>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="h-9 w-full rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 px-3 focus:outline-none focus:border-zinc-600"
            >
              <option value="fake_gateway">FakeGateway</option>
              <option value="xendit_sandbox">Xendit Sandbox</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Environment *</label>
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value as any })}
              className="h-9 w-full rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 px-3 focus:outline-none focus:border-zinc-600"
            >
              <option value="sandbox">Sandbox</option>
              <option value="test">Test</option>
              <option value="production">Production</option>
            </select>
          </div>
          <Input label="Provider Account Ref" value={form.providerAccountRef} onChange={(e) => setForm({ ...form, providerAccountRef: e.target.value })} placeholder="optional" />
          <Input label="Credentials Ref" value={form.credentialsRef} onChange={(e) => setForm({ ...form, credentialsRef: e.target.value })} placeholder="optional secret-store ref" />
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={handleCreateProvider} loading={creating}>Create</Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowAddProvider(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}
