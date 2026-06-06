"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfig } from "@/hooks/use-config";
import { useToast } from "@/hooks/use-toast";
import { ToastContainer } from "@/components/ui/toast";
import { PaymentOrchestrationClient } from "@northflow/payment-orchestration-client-sdk";

export default function SettingsPage() {
  const router = useRouter();
  const { config, configured, update, reset } = useConfig();
  const { toasts, toast, dismiss } = useToast();

  const [serviceUrl, setServiceUrl] = useState("");
  const [serviceToken, setServiceToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    if (config) {
      setServiceUrl(config.serviceUrl);
      setServiceToken(config.serviceToken);
    }
  }, [config]);

  const handleTest = async () => {
    if (!serviceUrl.trim() || !serviceToken.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: serviceUrl.trim(),
        serviceToken: serviceToken.trim(),
      });
      await client.getReadiness();
      setTestResult("success");
      toast("Connection successful", "success");
    } catch (e: any) {
      setTestResult("error");
      toast(e?.message ?? "Connection failed", "error");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!serviceUrl.trim() || !serviceToken.trim()) return;
    setSaving(true);
    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: serviceUrl.trim(),
        serviceToken: serviceToken.trim(),
      });
      await client.getReadiness();
      update({ serviceUrl: serviceUrl.trim(), serviceToken: serviceToken.trim() });
      toast("Settings saved", "success");
    } catch (e: any) {
      toast(`Save failed: ${e?.message ?? "Connection error"}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    reset();
    router.replace("/setup");
  };

  return (
    <>
      <PageHeader title="Settings" description="Dashboard configuration and connection settings" />

      <div className="max-w-xl space-y-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Service Connection</CardTitle>
              <CardDescription className="mt-0.5">Configure the payment orchestration service endpoint</CardDescription>
            </div>
            {configured && <Badge variant="success" dot>Connected</Badge>}
          </CardHeader>
          <div className="space-y-3">
            <Input
              label="Service URL"
              type="url"
              value={serviceUrl}
              onChange={(e) => setServiceUrl(e.target.value)}
              placeholder="http://localhost:5000"
              hint="Base URL of your payment orchestration service"
            />
            <Input
              label="Service Token"
              type="password"
              value={serviceToken}
              onChange={(e) => setServiceToken(e.target.value)}
              placeholder="••••••••••••••••"
              hint="PAYMENT_ORCHESTRATION_SERVICE_TOKEN value"
            />
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={handleSave} loading={saving}>
                Save Settings
              </Button>
              <Button variant="outline" onClick={handleTest} loading={testing} className="shrink-0">
                Test Connection
              </Button>
            </div>
            {testResult && (
              <p className={`text-xs ${testResult === "success" ? "text-green-500" : "text-red-500"}`}>
                {testResult === "success" ? "✓ Connection successful" : "✗ Connection failed"}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Storage</CardTitle>
              <CardDescription className="mt-0.5">Dashboard credentials are stored in your browser only</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-zinc-800/50 border border-zinc-800 px-3 py-2.5">
              <p className="text-xs text-zinc-500">
                No data is sent to any third-party service. Your service token and URL are stored in <code className="text-zinc-400 bg-zinc-800 px-1 rounded">localStorage</code> and never leave your browser.
              </p>
            </div>
            <Button variant="danger" size="sm" onClick={handleReset} className="w-full">
              Reset & Disconnect
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {[
              { label: "Dashboard Version", value: "0.1.0" },
              { label: "Service API", value: "Phase 8K (v0.3.0)" },
              { label: "SDK", value: "@northflow/payment-orchestration-client-sdk" },
            ].map((item) => (
              <div key={item.label} className="flex justify-between text-xs py-1.5 border-b border-zinc-800/40 last:border-0">
                <span className="text-zinc-500">{item.label}</span>
                <span className="text-zinc-400 font-mono">{item.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </>
  );
}
