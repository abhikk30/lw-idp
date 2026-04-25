import type { ReactNode } from "react";

export default function HomePage(): ReactNode {
  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold tracking-tight">lw-idp</h1>
      <p className="text-muted-foreground mt-2">
        Portal foundation in place. Real dashboard lands in D1.
      </p>
    </main>
  );
}
