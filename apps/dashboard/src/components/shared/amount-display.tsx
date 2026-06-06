"use client";

import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/sdk";

interface AmountDisplayProps {
  amount: number;
  currency?: string;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  positive?: boolean;
  negative?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base font-semibold",
};

export function AmountDisplay({
  amount,
  currency = "IDR",
  size = "md",
  muted,
  positive,
  negative,
  className,
}: AmountDisplayProps) {
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        sizeClasses[size],
        muted && "text-zinc-500",
        positive && "text-green-400",
        negative && "text-red-400",
        !muted && !positive && !negative && "text-zinc-200",
        className
      )}
    >
      {formatCurrency(amount, currency)}
    </span>
  );
}

interface IntentAmountsProps {
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  amountRemaining: number;
  currency?: string;
}

export function IntentAmounts({
  amountDue,
  amountPaid,
  amountRefunded,
  amountRemaining,
  currency = "IDR",
}: IntentAmountsProps) {
  const paidPct = amountDue > 0 ? Math.min((amountPaid / amountDue) * 100, 100) : 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">
          {formatCurrency(amountPaid, currency)} / {formatCurrency(amountDue, currency)}
        </span>
        <span className="text-zinc-400 font-medium">{Math.round(paidPct)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-zinc-300 transition-all duration-500"
          style={{ width: `${paidPct}%` }}
        />
      </div>
      {amountRefunded > 0 && (
        <p className="text-xs text-zinc-600">
          Refunded: {formatCurrency(amountRefunded, currency)}
        </p>
      )}
    </div>
  );
}
