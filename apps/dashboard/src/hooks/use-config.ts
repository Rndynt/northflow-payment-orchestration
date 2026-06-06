"use client";

import { useState, useEffect, useCallback } from "react";
import { getConfig, saveConfig, clearConfig, isConfigured, type DashboardConfig } from "@/lib/config";
import { resetClient } from "@/lib/sdk";

export function useConfig() {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [configured, setConfigured] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const cfg = getConfig();
    setConfig(cfg);
    setConfigured(isConfigured());
    setHydrated(true);
  }, []);

  const update = useCallback((newConfig: DashboardConfig) => {
    saveConfig(newConfig);
    setConfig(newConfig);
    setConfigured(Boolean(newConfig.serviceUrl && newConfig.serviceToken));
    resetClient();
  }, []);

  const reset = useCallback(() => {
    clearConfig();
    setConfig(null);
    setConfigured(false);
    resetClient();
  }, []);

  return { config, configured, hydrated, update, reset };
}
