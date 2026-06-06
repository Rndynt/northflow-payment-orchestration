"use client";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center gap-3", className)}>
      {icon && (
        <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-300">{title}</p>
        {description && <p className="text-xs text-zinc-600 max-w-xs">{description}</p>}
      </div>
      {action}
    </div>
  );
}
