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

export interface ServicesTableRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  lifecycle: string;
  ownerTeamId: string;
  updatedAt: string;
}

const SERVICE_TYPES = ["", "service", "library", "website", "ml", "job"] as const;
const LIFECYCLES = ["", "experimental", "production", "deprecated"] as const;

const columns: ColumnDef<ServicesTableRow>[] = [
  {
    accessorKey: "slug",
    header: "Slug",
    cell: ({ row }) => (
      <Link
        href={`/services/${row.original.id}`}
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
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => <Badge variant="secondary">{row.original.type}</Badge>,
  },
  {
    accessorKey: "lifecycle",
    header: "Lifecycle",
    cell: ({ row }) => (
      <Badge variant={row.original.lifecycle === "production" ? "default" : "outline"}>
        {row.original.lifecycle}
      </Badge>
    ),
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => {
      const ts = row.original.updatedAt;
      if (!ts) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="text-muted-foreground text-sm">{new Date(ts).toLocaleDateString()}</span>
      );
    },
  },
];

interface ServicesTableProps {
  /** Initial data from RSC fetch — passed to TanStack Query as initialData. */
  initialData: ServicesTableRow[];
}

type ServiceTypeQuery = "service" | "library" | "website" | "ml" | "job";
type LifecycleQuery = "experimental" | "production" | "deprecated";

export function ServicesTable({ initialData }: ServicesTableProps): ReactNode {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["services", { q, type: typeFilter, lifecycle: lifecycleFilter }],
    queryFn: async (): Promise<ServicesTableRow[]> => {
      const client = apiClient();
      const query: {
        q?: string;
        type?: ServiceTypeQuery;
        lifecycle?: LifecycleQuery;
      } = {};
      if (q) {
        query.q = q;
      }
      if (typeFilter) {
        query.type = typeFilter as ServiceTypeQuery;
      }
      if (lifecycleFilter) {
        query.lifecycle = lifecycleFilter as LifecycleQuery;
      }
      const { data: resp, error } = await client.GET("/services", { params: { query } });
      if (error || !resp) {
        throw new Error("Failed to load services");
      }
      return (resp.items ?? []).map(
        (s): ServicesTableRow => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          type: s.type ?? "service",
          lifecycle: s.lifecycle ?? "experimental",
          ownerTeamId: s.ownerTeamId ?? "",
          updatedAt: s.updatedAt ?? s.createdAt ?? "",
        }),
      );
    },
    initialData: !q && !typeFilter && !lifecycleFilter ? initialData : undefined,
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
          aria-label="Search services"
          placeholder="Search slug or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select
          aria-label="Filter by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          {SERVICE_TYPES.map((t) => (
            <option key={t || "any"} value={t}>
              {t || "All types"}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by lifecycle"
          value={lifecycleFilter}
          onChange={(e) => setLifecycleFilter(e.target.value)}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          {LIFECYCLES.map((l) => (
            <option key={l || "any"} value={l}>
              {l || "All lifecycles"}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button asChild>
          <Link href="/services/new">Register service</Link>
        </Button>
      </div>

      {/* Table */}
      {isError ? (
        <p className="text-destructive text-sm">Failed to load services.</p>
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
                    {q || typeFilter || lifecycleFilter
                      ? "No services match your filters."
                      : "No services yet — register your first one."}
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
