"use client";

import type { components } from "@lw-idp/contracts/gateway";
import { Badge } from "@lw-idp/ui/components/badge";
import { Button } from "@lw-idp/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lw-idp/ui/components/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import Link from "next/link";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ulid } from "ulid";
import { apiClient } from "../../lib/api/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape returned by GET /api/v1/services/import-candidates. The route is not
 * (yet) part of the typed gateway OpenAPI spec, so we mirror the gateway
 * Fastify handler shape directly here. Keep in sync with
 * `apps/gateway-svc/src/http/import.ts`.
 */
export interface ImportCandidate {
  name: string;
  repoUrl: string;
  targetRevision: string;
  path: string;
  destinationNamespace: string;
  sync: { status: string; revision?: string };
  health: { status: string };
}

export interface ImportTeamRef {
  id: string;
  slug: string;
  name: string;
}

export interface ImportTableProps {
  /** Initial candidates from RSC fetch — passed to TanStack Query as initialData. */
  initialCandidates: ImportCandidate[];
  /**
   * The current user's teams from /me. The first team is auto-selected as the
   * `ownerTeamId` for every imported service.
   *
   * NOTE (P2.0.5 deviation): we deliberately auto-pick `teams[0]` rather than
   * rendering a per-row team picker, to keep the import flow one-click. P1.9
   * may revisit this if multi-team users want explicit ownership control.
   */
  teams: ImportTeamRef[];
}

type RowStatus =
  | { status: "idle" }
  | { status: "importing" }
  | { status: "imported" }
  | { status: "failed"; message: string };

// ---------------------------------------------------------------------------
// Status pills (mirror services-table.client.tsx)
// ---------------------------------------------------------------------------

function SyncPill({ status }: { status: string }): ReactNode {
  if (status === "Synced") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-transparent bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
        data-testid="sync-pill"
      >
        Synced
      </span>
    );
  }
  if (status === "OutOfSync") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-transparent bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400"
        data-testid="sync-pill"
      >
        OutOfSync
      </span>
    );
  }
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      data-testid="sync-pill"
    >
      {status}
    </span>
  );
}

function HealthPill({ status }: { status: string }): ReactNode {
  if (status === "Healthy") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-transparent bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
        data-testid="health-pill"
      >
        Healthy
      </span>
    );
  }
  if (status === "Degraded") {
    return (
      <span
        className="bg-destructive/10 text-destructive inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium"
        data-testid="health-pill"
      >
        Degraded
      </span>
    );
  }
  if (status === "Progressing") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-transparent bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400"
        data-testid="health-pill"
      >
        Progressing
      </span>
    );
  }
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      data-testid="health-pill"
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Action cell — encapsulates per-row import state + mutation
// ---------------------------------------------------------------------------

interface ImportActionProps {
  candidate: ImportCandidate;
  ownerTeamId: string | undefined;
  onImported: (name: string) => void;
}

function ImportAction({ candidate, ownerTeamId, onImported }: ImportActionProps): ReactNode {
  const [state, setState] = useState<RowStatus>({ status: "idle" });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!ownerTeamId) {
        throw new Error("No team available to assign as owner");
      }
      const client = apiClient();
      const body: components["schemas"]["ServiceCreate"] = {
        slug: candidate.name,
        // Use the Argo CD app name as the display name. The catalog API echoes
        // it back; the user can rename later in the edit form.
        name: candidate.name,
        type: "service",
        lifecycle: "experimental",
        ownerTeamId,
        ...(candidate.repoUrl ? { repoUrl: candidate.repoUrl } : {}),
      };
      const { data, error } = await client.POST("/services", {
        body,
        headers: { "Idempotency-Key": ulid() },
      });
      if (error || !data) {
        const msg =
          (error && typeof error === "object" && "message" in error
            ? String((error as { message?: unknown }).message)
            : null) ?? "Failed to import service";
        throw new Error(msg);
      }
      return data;
    },
    onMutate: () => {
      setState({ status: "importing" });
    },
    onSuccess: () => {
      setState({ status: "imported" });
      onImported(candidate.name);
    },
    onError: (err: Error) => {
      setState({ status: "failed", message: err.message });
    },
  });

  if (state.status === "imported") {
    return (
      <span
        className="text-muted-foreground inline-flex items-center gap-1 text-xs"
        data-testid="import-status"
      >
        ✓ Imported
      </span>
    );
  }

  const disabled = !ownerTeamId || state.status === "importing";
  const title = !ownerTeamId
    ? "You must belong to a team to import services"
    : state.status === "failed"
      ? `Failed: ${state.message}`
      : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={disabled}
        title={title}
        data-testid={`import-btn-${candidate.name}`}
      >
        {state.status === "importing"
          ? "Importing…"
          : state.status === "failed"
            ? "Retry"
            : "Import"}
      </Button>
      {state.status === "failed" ? (
        <span className="text-destructive text-xs" data-testid={`import-error-${candidate.name}`}>
          Failed: {state.message}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table column factory
// ---------------------------------------------------------------------------

function buildColumns(
  ownerTeamId: string | undefined,
  onImported: (name: string) => void,
): ColumnDef<ImportCandidate>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-mono text-sm font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "repoUrl",
      header: "Repo",
      cell: ({ row }) => (
        <span
          className="text-muted-foreground block max-w-[16rem] truncate text-xs"
          title={row.original.repoUrl}
        >
          {row.original.repoUrl || "—"}
        </span>
      ),
    },
    {
      accessorKey: "targetRevision",
      header: "Branch",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.targetRevision || "—"}
        </Badge>
      ),
    },
    {
      accessorKey: "path",
      header: "Path",
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-xs">{row.original.path || "—"}</span>
      ),
    },
    {
      id: "sync",
      header: "Sync",
      cell: ({ row }) => <SyncPill status={row.original.sync.status} />,
    },
    {
      id: "health",
      header: "Health",
      cell: ({ row }) => <HealthPill status={row.original.health.status} />,
    },
    {
      id: "action",
      header: () => <span className="sr-only">Action</span>,
      cell: ({ row }) => (
        <ImportAction candidate={row.original} ownerTeamId={ownerTeamId} onImported={onImported} />
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ImportCandidatesResponse {
  candidates: ImportCandidate[];
}

export function ImportTable({ initialCandidates, teams }: ImportTableProps): ReactNode {
  // Locally hide rows once imported, so the user doesn't see a stale "✓ Imported"
  // mixed in with not-yet-imported candidates after multiple clicks.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const ownerTeamId = teams[0]?.id;

  const { data } = useQuery({
    queryKey: ["services", "import-candidates"],
    queryFn: async (): Promise<ImportCandidatesResponse> => {
      const res = await fetch("/api/v1/services/import-candidates", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Failed to load import candidates (${res.status})`);
      }
      return (await res.json()) as ImportCandidatesResponse;
    },
    initialData: { candidates: initialCandidates },
    staleTime: 30_000,
  });

  const candidates = (data?.candidates ?? []).filter((c) => !hidden.has(c.name));

  // Stable handler so the columns memo doesn't churn every render.
  const onImported = useCallback((name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  // Memoize columns so TanStack Table sees a stable reference across renders.
  // Without this, every `setHidden` re-creates the columns array which can
  // cause the table to reset internal state and remount cell components —
  // destroying the per-row useState/useMutation in <ImportAction>.
  const columns = useMemo(() => buildColumns(ownerTeamId, onImported), [ownerTeamId, onImported]);

  const table = useReactTable({
    data: candidates,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Stable row IDs (candidate name is unique). Without this, TanStack uses
    // the row index — when row 0 is hidden after import, every other row's
    // index shifts, React unmounts/remounts every <ImportAction>, and any
    // in-flight per-row mutation state is lost. Keying by name preserves
    // identity so unaffected rows keep their `useState`.
    getRowId: (row) => row.name,
  });

  if (candidates.length === 0) {
    return (
      <div
        className="border-border bg-muted/20 flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-12 text-center"
        data-testid="import-empty-state"
      >
        <p className="text-sm font-medium">No orphans</p>
        <p className="text-muted-foreground text-sm">
          Every Argo CD Application has a catalog row.
        </p>
        <Link href="/services" className="text-primary mt-2 text-sm underline">
          Back to services
        </Link>
      </div>
    );
  }

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead key={h.id}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
