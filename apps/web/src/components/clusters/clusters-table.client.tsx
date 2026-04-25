"use client";

import { Badge } from "@lw-idp/ui/components/badge";
import { Button } from "@lw-idp/ui/components/button";
import { Input } from "@lw-idp/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lw-idp/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { apiClient } from "../../lib/api/client.js";

export interface ClustersTableRow {
  id: string;
  slug: string;
  name: string;
  environment: string;
  region: string;
  provider: string;
  createdAt: string;
}

const ENVIRONMENTS = ["", "dev", "stage", "prod"] as const;

const columns: ColumnDef<ClustersTableRow>[] = [
  {
    accessorKey: "slug",
    header: "Slug",
    cell: ({ row }) => (
      <Link
        href={`/clusters/${row.original.id}`}
        className="text-primary font-mono text-sm hover:underline"
      >
        {row.original.slug}
      </Link>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "environment",
    header: "Environment",
    cell: ({ row }) => {
      const e = row.original.environment;
      const v = e === "prod" ? "default" : e === "stage" ? "secondary" : "outline";
      return <Badge variant={v}>{e}</Badge>;
    },
  },
  { accessorKey: "region", header: "Region" },
  { accessorKey: "provider", header: "Provider" },
  {
    accessorKey: "createdAt",
    header: "Registered",
    cell: ({ row }) => {
      const ts = row.original.createdAt;
      if (!ts) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="text-muted-foreground text-sm">{new Date(ts).toLocaleDateString()}</span>
      );
    },
  },
];

interface ClustersTableProps {
  /** Initial data from RSC fetch — passed to TanStack Query as initialData. */
  initialData: ClustersTableRow[];
}

type EnvironmentQuery = "dev" | "stage" | "prod";

export function ClustersTable({ initialData }: ClustersTableProps): ReactNode {
  const [q, setQ] = useState("");
  const [envFilter, setEnvFilter] = useState<string>("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["clusters", { q, env: envFilter }],
    queryFn: async (): Promise<ClustersTableRow[]> => {
      const client = apiClient();
      const query: { env?: EnvironmentQuery } = {};
      if (envFilter) {
        query.env = envFilter as EnvironmentQuery;
      }
      const { data: resp, error } = await client.GET("/clusters", { params: { query } });
      if (error || !resp) {
        throw new Error("Failed to load clusters");
      }
      const items = (resp.items ?? []).map(
        (c): ClustersTableRow => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          environment: c.environment ?? "dev",
          region: c.region ?? "",
          provider: c.provider ?? "kind",
          createdAt: c.createdAt ?? "",
        }),
      );
      // Client-side substring filter on slug/name; the gateway list endpoint
      // doesn't accept a free-text `q` parameter, so we filter in-memory.
      if (!q) {
        return items;
      }
      const needle = q.toLowerCase();
      return items.filter(
        (c) => c.slug.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
      );
    },
    initialData: !q && !envFilter ? initialData : undefined,
    staleTime: 30_000,
  });

  const rows = data ?? [];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search clusters"
          placeholder="Search slug or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select
          aria-label="Filter by environment"
          value={envFilter}
          onChange={(e) => setEnvFilter(e.target.value)}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          {ENVIRONMENTS.map((e) => (
            <option key={e || "any"} value={e}>
              {e || "All environments"}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button asChild>
          <Link href="/clusters/new">Register cluster</Link>
        </Button>
      </div>

      {/* Table */}
      {isError ? (
        <p className="text-destructive text-sm">Failed to load clusters.</p>
      ) : (
        <div className="border-border overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading && rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="text-muted-foreground py-6 text-center"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="text-muted-foreground py-6 text-center"
                  >
                    {q || envFilter
                      ? "No clusters match your filters."
                      : "No clusters yet — register your first one."}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
