"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface CopyIdProps {
  id: string;
  truncate?: number;
  className?: string;
}

export function CopyId({ id, truncate = 8, className }: CopyIdProps) {
  const [copied, setCopied] = useState(false);

  const display = id.length > truncate ? `${id.slice(0, truncate)}…` : id;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <button
      onClick={handleCopy}
      title={id}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs text-zinc-500 hover:text-zinc-300 transition-colors",
        className
      )}
    >
      <span>{display}</span>
      {copied ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-500">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}
