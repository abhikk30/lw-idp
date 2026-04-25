"use client";

import type { Deployment } from "@lw-idp/contracts";
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
  Deployment["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  succeeded: "default",
  failed: "destructive",
  in_progress: "secondary",
};

export interface DeploymentsTableProps {
  deployments: Deployment[];
}

export function DeploymentsTable({ deployments }: DeploymentsTableProps): React.ReactNode {
  if (deployments.length === 0) {
    return <p className="text-muted-foreground text-sm">No deployments yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Commit</TableHead>
          <TableHead>Environment</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Triggered</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deployments.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="font-mono text-xs">{d.commitSha}</TableCell>
            <TableCell>
              <Badge variant={d.environment === "prod" ? "default" : "secondary"}>
                {d.environment}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[d.status]}>{d.status.replace("_", " ")}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {new Date(d.createdAt).toLocaleString()}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {d.durationSeconds > 0 ? `${d.durationSeconds}s` : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
