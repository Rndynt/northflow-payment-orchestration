"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getClient } from "@/lib/sdk";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyId } from "@/components/shared/copy-id";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";
import type { MerchantResponse } from "@northflow/payment-orchestration-client-sdk";

export default function MerchantsPage() {
  const router = useRouter();
  const { toasts, toast, dismiss } = useToast();
  const [merchants, setMerchants] = useState<MerchantResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", legalName: "", sourceApp: "", externalRef: "" });
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const client = getClient();
      // Service has no list endpoint — we can't paginate merchants without a DB query
      // For Phase 1 we show a single merchant lookup by ID or the create flow
      setMerchants([]);
    } catch {
      setMerchants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError("Name is required."); return; }
    setFormError("");
    setCreating(true);
    try {
      const client = getClient();
      const merchant = await client.createMerchant({
        id: form.id.trim() || undefined,
        name: form.name.trim(),
        legalName: form.legalName.trim() || null,
        sourceApp: form.sourceApp.trim() || null,
        externalRef: form.externalRef.trim() || null,
      });
      setMerchants((prev) => {
        const exists = prev.find((m) => m.id === merchant.id);
        return exists ? prev.map((m) => m.id === merchant.id ? merchant : m) : [merchant, ...prev];
      });
      setShowCreate(false);
      setForm({ id: "", name: "", legalName: "", sourceApp: "", externalRef: "" });
      toast("Merchant created successfully", "success");
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to create merchant");
    } finally {
      setCreating(false);
    }
  };

  const columns: Column<MerchantResponse>[] = [
    {
      key: "id",
      header: "ID",
      width: "140px",
      render: (row) => <CopyId id={row.id} truncate={10} />,
    },
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div>
          <p className="text-zinc-200 font-medium text-sm">{row.name}</p>
          {row.legalName && <p className="text-xs text-zinc-600 mt-0.5">{row.legalName}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (row) => (
        <Badge
          variant={row.status === "active" ? "success" : row.status === "suspended" ? "warning" : "neutral"}
          dot
        >
          {row.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      align: "right",
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => router.push(`/merchants/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Merchants"
        description="Manage merchant accounts and their provider configurations"
        action={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <PlusIcon /> New Merchant
          </Button>
        }
      />

      <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900">
        <DataTable
          columns={columns}
          data={merchants}
          loading={loading}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/merchants/${r.id}`)}
          emptyTitle="No merchants yet"
          emptyDescription="Create your first merchant to start processing payments"
          emptyIcon={<MerchantsEmptyIcon />}
        />
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-xs text-zinc-600 mb-3 font-medium uppercase tracking-wide">Look up merchant by ID</p>
        <MerchantLookup onFound={(m) => setMerchants((prev) => {
          const exists = prev.find((x) => x.id === m.id);
          return exists ? prev : [m, ...prev];
        })} />
      </div>

      <Dialog
        open={showCreate}
        onClose={() => { setShowCreate(false); setFormError(""); }}
        title="New Merchant"
        description="Create a merchant account for payment orchestration"
      >
        <div className="space-y-3">
          <Input label="Merchant ID" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="auto-generated if empty" />
          <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Corp" />
          <Input label="Legal Name" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="optional" />
          <Input label="Source App" value={form.sourceApp} onChange={(e) => setForm({ ...form, sourceApp: e.target.value })} placeholder="e.g. consumer-a" />
          <Input label="External Ref" value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} placeholder="external merchant reference" />
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={handleCreate} loading={creating}>Create</Button>
            <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}

function MerchantLookup({ onFound }: { onFound: (m: MerchantResponse) => void }) {
  const [id, setId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLookup = async () => {
    if (!id.trim()) return;
    setError("");
    setLoading(true);
    try {
      const client = getClient();
      const merchant = await client.getMerchant(id.trim());
      onFound(merchant);
      setId("");
    } catch (e: any) {
      setError(e?.message ?? "Merchant not found");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Merchant ID"
        onKeyDown={(e) => e.key === "Enter" && handleLookup()}
        error={error}
        className="flex-1"
      />
      <Button variant="outline" size="md" onClick={handleLookup} loading={loading} className="shrink-0">
        Lookup
      </Button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MerchantsEmptyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
