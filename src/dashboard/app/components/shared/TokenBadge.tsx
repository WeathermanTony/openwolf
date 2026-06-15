import React from "react";
import { cn, formatTokens } from "../../lib/utils.js";

export function TokenBadge({ tokens, className }: { tokens: number; className?: string }) {
  const color = tokens < 200 ? "text-emerald-400" : tokens < 1000 ? "text-amber-400" : "text-red-400";
  return (
    <span className={cn("font-mono text-xs", color, className)}>
      ~{formatTokens(tokens)} tok
    </span>
  );
}
