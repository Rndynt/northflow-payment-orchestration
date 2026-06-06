"use client";

import { cn } from "@/lib/utils";
import type { StatusVariant } from "@/lib/status";

interface BadgeProps {
  variant?: StatusVariant | "default";
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const variantClasses: Record<string, string> = {
  success: "bg-green-950/60 text-green-400 border border-green-900/40",
  warning: "bg-amber-950/60 text-amber-400 border border-amber-900/40",
  danger:  "bg-red-950/60 text-red-400 border border-red-900/40",
  info:    "bg-blue-950/60 text-blue-400 border border-blue-900/40",
  pending: "bg-zinc-800/80 text-zinc-300 border border-zinc-700/60",
  neutral: "bg-zinc-900/80 text-zinc-500 border border-zinc-800/60",
  default: "bg-zinc-800 text-zinc-300 border border-zinc-700",
};

const dotClasses: Record<string, string> = {
  success: "bg-green-400",
  warning: "bg-amber-400",
  danger:  "bg-red-400",
  info:    "bg-blue-400",
  pending: "bg-zinc-400",
  neutral: "bg-zinc-600",
  default: "bg-zinc-400",
};

export function Badge({ variant = "default", children, className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums",
        variantClasses[variant] ?? variantClasses.default,
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            dotClasses[variant] ?? dotClasses.default
          )}
        />
      )}
      {children}
    </span>
  );
}
