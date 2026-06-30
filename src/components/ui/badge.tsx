import type { HTMLAttributes } from "react";
import { forwardRef } from "react";

import { cn } from "./cn";

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
  secondary: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  destructive: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  outline:
    "border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = "secondary", ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-5",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
});

Badge.displayName = "Badge";
