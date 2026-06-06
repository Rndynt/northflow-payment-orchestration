"use client";

import { cn } from "@/lib/utils";
import type { Toast } from "@/hooks/use-toast";

interface ToastContainerProps {
  toasts: Toast[];
  dismiss: (id: string) => void;
}

const typeClasses: Record<string, string> = {
  success: "bg-green-950/90 border-green-900/60 text-green-300",
  error:   "bg-red-950/90 border-red-900/60 text-red-300",
  info:    "bg-zinc-900/95 border-zinc-800 text-zinc-200",
};

export function ToastContainer({ toasts, dismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur-sm",
            "animate-in slide-in-from-bottom-2 fade-in duration-200",
            typeClasses[t.type] ?? typeClasses.info
          )}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="text-current opacity-50 hover:opacity-100 transition-opacity shrink-0 mt-0.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
