import React from "react";
import { cn } from "../../lib/utils.js";

const variants: Record<string, string> = {
  healthy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  success: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  ok: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  enabled: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  retrying: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  degraded: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  stopped: "bg-red-500/20 text-red-400 border-red-500/30",
  disabled: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  unknown: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  initialized: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = variants[status.toLowerCase()] || variants.unknown;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", variant, className)}>
      {status === "running" || status === "healthy" ? (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 pulse-green" />
      ) : null}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
