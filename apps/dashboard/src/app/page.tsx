"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isConfigured } from "@/lib/config";

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    if (isConfigured()) router.replace("/overview");
    else router.replace("/setup");
  }, [router]);
  return null;
}
