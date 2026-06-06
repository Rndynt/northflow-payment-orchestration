"use client";

import { cn } from "@/lib/utils";

export function Separator({ className, orientation = "horizontal" }: { className?: string; orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      className={cn(
        "bg-zinc-800",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className
      )}
    />
  );
}
