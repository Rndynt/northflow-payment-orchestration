"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { saveConfig } from "@/lib/config";
import { PaymentOrchestrationClient } from "@northflow/payment-orchestration-client-sdk";

function getDefaultServiceUrl(): string {
  const replitDomain = process.env.NEXT_PUBLIC_REPLIT_DEV_DOMAIN;
  if (replitDomain) {
    return `https://3001-${replitDomain}`;
  }
  return "http://localhost:3001";
}

export default function SetupPage() {
  const router = useRouter();
  const [serviceUrl, setServiceUrl] = useState(getDefaultServiceUrl());
  const [serviceToken, setServiceToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!serviceUrl.trim() || !serviceToken.trim()) {
      setError("Both fields are required.");
      return;
    }
    setError("");
    setTesting(true);
    try {
      const client = new PaymentOrchestrationClient({
        baseUrl: serviceUrl.trim(),
        serviceToken: serviceToken.trim(),
      });
      await client.getReadiness();
      saveConfig({ serviceUrl: serviceUrl.trim(), serviceToken: serviceToken.trim() });
      router.replace("/");
    } catch (e: any) {
      setError(e?.message ?? "Connection failed. Check the URL and token.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="h-10 w-10 rounded-xl bg-zinc-100 flex items-center justify-center mx-auto">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#09090b" strokeWidth="2.5">
              <path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-zinc-100">Northflow Dashboard</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Connect to your payment service</p>
          </div>
        </div>

        <Card className="space-y-4">
          <Input
            label="Service URL"
            type="url"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            placeholder="https://3001-your-replit-domain"
            hint="The base URL of your payment orchestration service"
          />
          <Input
            label="Service Token"
            type="password"
            value={serviceToken}
            onChange={(e) => setServiceToken(e.target.value)}
            placeholder="Your service token"
            hint="PAYMENT_ORCHESTRATION_SERVICE_TOKEN value"
          />
          {error && (
            <div className="rounded-lg bg-red-950/40 border border-red-900/40 px-3 py-2.5">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          <Button
            className="w-full"
            onClick={handleSave}
            loading={testing}
          >
            {testing ? "Connecting…" : "Connect"}
          </Button>
        </Card>

        <p className="text-center text-xs text-zinc-700">
          Credentials are stored locally in your browser only.
        </p>
      </div>
    </div>
  );
}
