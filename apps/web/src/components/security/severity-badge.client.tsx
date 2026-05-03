"use client";
import type { ReactNode } from "react";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

const styles: Record<Severity, string> = {
  CRITICAL: "bg-red-700 text-white",
  HIGH: "bg-red-500 text-white",
  MEDIUM: "bg-amber-500 text-black",
  LOW: "bg-slate-500 text-white",
  UNKNOWN: "bg-slate-400 text-white",
};

export function SeverityBadge({ severity }: { severity: string }): ReactNode {
  const upper = (severity ?? "UNKNOWN").toUpperCase();
  const norm: Severity = upper in styles ? (upper as Severity) : "UNKNOWN";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold ${styles[norm]}`}
    >
      {norm}
    </span>
  );
}
