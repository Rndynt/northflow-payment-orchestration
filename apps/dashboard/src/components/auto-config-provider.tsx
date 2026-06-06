"use client";

import { useEffect } from "react";
import { getConfig, saveConfig } from "@/lib/config";

export function AutoConfigProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const existing = getConfig();
    const alreadyProxy = existing?.serviceUrl?.startsWith("/api/proxy");
    if (alreadyProxy) return;

    fetch("/api/auto-config")
      .then((r) => r.json())
      .then((data) => {
        if (data.configured) {
          saveConfig({ serviceUrl: data.serviceUrl, serviceToken: data.serviceToken });
          window.location.reload();
        }
      })
      .catch(() => {});
  }, []);

  return <>{children}</>;
}
