import React from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="md:ml-60 min-h-screen p-6 pb-20 md:pb-6">
      {children}
    </main>
  );
}
