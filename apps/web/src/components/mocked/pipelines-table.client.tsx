"use client";

import type { Pipeline } from "@lw-idp/contracts";
import { Badge } from "@lw-idp/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lw-idp/ui/components/table";

const STATUS_VARIANT: Record<
  Pipeline["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  success: "default",
  failed: "destructive",
  running: "secondary",
};

export interface PipelinesTableProps {
  pipelines: Pipeline[];
}

export function PipelinesTable({ pipelines }: PipelinesTableProps): React.ReactNode {
  if (pipelines.length === 0) {
    return <p className="text-muted-foreground text-sm">No pipelines yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Branch</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Triggered by</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pipelines.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-mono text-xs">{p.branch}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
            </TableCell>
            <TableCell className="text-sm">{p.triggeredBy}</TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {new Date(p.createdAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {p.durationSeconds > 0 ? `${p.durationSeconds}s` : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
