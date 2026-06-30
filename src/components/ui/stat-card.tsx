import type { ReactNode } from "react";

import { cn } from "./cn";
import { Card } from "./card";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  delta?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  description,
  delta,
  icon,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 sm:text-3xl">
            {value}
          </div>
        </div>

        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            {icon}
          </div>
        ) : null}
      </div>

      {(description || delta) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {description ? <p className="text-slate-600 dark:text-slate-300">{description}</p> : null}
          {delta ? (
            <div className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {delta}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
