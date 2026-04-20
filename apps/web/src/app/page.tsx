import type { ReactNode } from "react";

export default function HomePage(): ReactNode {
  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1>lw-idp</h1>
      <p style={{ opacity: 0.7 }}>
        Internal Developer Platform — Plan 1.2 skeleton. Real portal UI lands in Plan 1.7.
      </p>
    </main>
  );
}
