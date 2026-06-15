import React from "react";

export function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="font-medium mb-1" style={{ color: "var(--text-secondary)" }}>{title}</h3>
      <p className="text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>{description}</p>
    </div>
  );
}
