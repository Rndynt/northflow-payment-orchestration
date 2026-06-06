"use client";

import { cn } from "@/lib/utils";
import { forwardRef } from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

const variantClasses: Record<string, string> = {
  default: "bg-zinc-100 text-zinc-900 hover:bg-white border border-zinc-200/10",
  outline: "bg-transparent text-zinc-300 border border-zinc-700 hover:border-zinc-600 hover:text-zinc-100",
  ghost:   "bg-transparent text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border border-transparent",
  danger:  "bg-red-950/60 text-red-400 border border-red-900/50 hover:bg-red-900/40 hover:text-red-300",
  success: "bg-green-950/60 text-green-400 border border-green-900/50 hover:bg-green-900/40 hover:text-green-300",
};

const sizeClasses: Record<string, string> = {
  sm:   "h-7 px-2.5 text-xs rounded-md gap-1.5",
  md:   "h-9 px-3.5 text-sm rounded-lg gap-2",
  lg:   "h-11 px-5 text-base rounded-lg gap-2",
  icon: "h-8 w-8 rounded-lg flex items-center justify-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", loading, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <>
            <Spinner className="shrink-0" />
            {children}
          </>
        ) : children}
      </button>
    );
  }
);

Button.displayName = "Button";

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 animate-spin", className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
