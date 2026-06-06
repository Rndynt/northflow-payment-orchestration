"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  trend?: { value: string; positive?: boolean };
  loading?: boolean;
  className?: string;
}

export function StatCard({ label, value, sub, icon, trend, loading, className }: StatCardProps) {
  return (
    <Card className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{label}</p>
        {icon && (
          <span className="text-zinc-700">{icon}</span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ) : (
        <div>
          <p className="text-2xl font-semibold text-zinc-100 tabular-nums leading-none">{value}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {sub && <p className="text-xs text-zinc-600">{sub}</p>}
            {trend && (
              <span className={cn(
                "text-xs font-medium",
                trend.positive ? "text-green-500" : "text-red-500"
              )}>
                {trend.value}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
