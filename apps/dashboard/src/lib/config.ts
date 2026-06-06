"use client";

const CONFIG_KEY = "northflow_dashboard_config";

export interface DashboardConfig {
  serviceUrl: string;
  serviceToken: string;
}

export function getConfig(): DashboardConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: DashboardConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CONFIG_KEY);
}

export function isConfigured(): boolean {
  const cfg = getConfig();
  return Boolean(cfg?.serviceUrl && cfg?.serviceToken);
}
