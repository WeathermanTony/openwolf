import React from "react";
import { LiveIndicator } from "../shared/LiveIndicator.js";
import type { Theme } from "../../hooks/useTheme.js";

interface HeaderProps {
  title: string;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Header({ title, theme, onToggleTheme }: HeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{title}</h1>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleTheme}
          className="md:hidden p-2 rounded-md transition-colors text-sm"
          style={{ color: "var(--text-muted)" }}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <LiveIndicator />
      </div>
    </div>
  );
}
