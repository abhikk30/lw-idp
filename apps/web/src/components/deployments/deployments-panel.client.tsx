"use client";

import type { ArgoApplication, ArgoHealthStatus, ArgoSyncStatus } from "@lw-idp/contracts";
import { Badge } from "@lw-idp/ui/components/badge";
import { Button } from "@lw-idp/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import { HardSyncDialog } from "@lw-idp/ui/components/hard-sync-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { createArgoCdAdapter } from "../../lib/adapters/argocd.js";

/**
 * P2.0 base URL for the Argo CD UI in dev. P1.9 hardens this with the real
 * cert + domain; until then this is acceptable per the E3 task brief.
 */
const ARGO_CD_UI_BASE = "http://argocd.lw-idp.local";

/** Format ISO timestamp as "PP p" (e.g. "Apr 26, 2026 11:45 AM"). */
function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Lightweight relative-time helper (no date-fns dependency in apps/web). */
function formatRelativeAge(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) {
    return rtf.format(diffSec, "second");
  }
  if (abs < 3600) {
    return rtf.format(Math.round(diffSec / 60), "minute");
  }
  if (abs < 86_400) {
    return rtf.format(Math.round(diffSec / 3600), "hour");
  }
  return rtf.format(Math.round(diffSec / 86_400), "day");
}

function shortRevision(rev: string): string {
  if (!rev) {
    return "—";
  }
  return rev.slice(0, 7);
}

/** Tailwind tokens for sync status pills. */
function syncBadgeClass(status: ArgoSyncStatus): string {
  switch (status) {
    case "Synced":
      return "border-transparent bg-green-500/10 text-green-700 dark:text-green-400";
    case "OutOfSync":
      return "border-transparent bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
    default:
      return "";
  }
}

/** Tailwind tokens for health status pills. */
function healthBadgeClass(status: ArgoHealthStatus): string {
  switch (status) {
    case "Healthy":
      return "border-transparent bg-green-500/10 text-green-700 dark:text-green-400";
    case "Progressing":
      return "border-transparent bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
    case "Degraded":
      return "border-transparent bg-destructive/10 text-destructive";
    default:
      return "";
  }
}

function syncBadgeVariant(status: ArgoSyncStatus): "default" | "secondary" | "outline" {
  if (status === "Synced") {
    return "default";
  }
  if (status === "OutOfSync") {
    return "secondary";
  }
  return "outline";
}

function healthBadgeVariant(
  status: ArgoHealthStatus,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "Healthy") {
    return "default";
  }
  if (status === "Progressing") {
    return "secondary";
  }
  if (status === "Degraded") {
    return "destructive";
  }
  return "outline";
}

export interface DeploymentsPanelProps {
  initialApplication: ArgoApplication;
  serviceSlug: string;
}

/**
 * Live Argo CD Application status panel. Polls every 30s and is also
 * invalidated by the EventStreamProvider on `idp.deploy.application.*`
 * frames (E4 wired the invalidation key).
 *
 * Action bar:
 *  - Sync       → adapter.sync(slug)
 *  - Hard Sync  → adapter.sync(slug, { prune: true, force: true }) gated by
 *                 the HardSyncDialog (E2).
 */
export function DeploymentsPanel({
  initialApplication,
  serviceSlug,
}: DeploymentsPanelProps): ReactNode {
  const adapter = useMemo(() => createArgoCdAdapter(), []);
  const queryClient = useQueryClient();
  const [hardSyncOpen, setHardSyncOpen] = useState(false);

  const { data: application } = useQuery({
    queryKey: ["applications", serviceSlug],
    queryFn: () => adapter.getApplication(serviceSlug),
    initialData: initialApplication,
    refetchInterval: 30_000,
  });

  const app = application ?? initialApplication;

  // Replicas live in the resource-tree response, not the Application itself.
  // Fetched separately so the listApplications path (services-list pill) stays
  // a single API call. WS invalidations on `["applications"]` also hit this
  // by prefix match.
  const { data: replicas } = useQuery({
    queryKey: ["applications", serviceSlug, "replicas"],
    queryFn: () => adapter.getReplicaCounts(serviceSlug),
    refetchInterval: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => adapter.sync(serviceSlug),
    onMutate: () => {
      toast(`Sync requested for ${serviceSlug}`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Sync failed";
      toast.error(message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications", serviceSlug] });
    },
  });

  const hardSyncMutation = useMutation({
    mutationFn: () => adapter.sync(serviceSlug, { prune: true, force: true }),
    onMutate: () => {
      toast(`Hard Sync requested for ${serviceSlug}`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Hard Sync failed";
      toast.error(message);
    },
    onSettled: () => {
      setHardSyncOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["applications", serviceSlug] });
    },
  });

  // Prefer the resource-tree-derived counts when available; fall back to the
  // Application's static `replicas` field (which is currently always 0/0 from
  // the basic mapping but will populate once the upstream Application response
  // carries Pod summary data in a future Argo CD version).
  const ready = replicas?.ready ?? app.replicas.ready;
  const desired = replicas?.desired ?? app.replicas.desired;
  const replicasLabel = ready === 0 && desired === 0 ? "—" : `${ready} / ${desired}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Deployments</CardTitle>
          <CardDescription>
            Live Argo CD Application status for <span className="font-mono">{app.name}</span>.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || hardSyncMutation.isPending}
          >
            {syncMutation.isPending ? "Syncing…" : "Sync"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setHardSyncOpen(true)}
            disabled={syncMutation.isPending || hardSyncMutation.isPending}
          >
            Hard Sync
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Header strip */}
        <div className="text-muted-foreground grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
          <Field label="Cluster">
            <span className="font-mono">dev</span>
          </Field>
          <Field label="Revision">
            <span className="font-mono">{shortRevision(app.sync.revision)}</span>
          </Field>
          <Field label="Age">
            <span>{app.lastSyncAt ? formatRelativeAge(app.lastSyncAt) : "—"}</span>
          </Field>
          <Field label="Argo CD">
            <a
              href={`${ARGO_CD_UI_BASE}/applications/${encodeURIComponent(app.name)}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Open in Argo CD →
            </a>
          </Field>
        </div>

        {/* Status row */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={syncBadgeVariant(app.sync.status)}
            className={syncBadgeClass(app.sync.status)}
            aria-label={`Sync status: ${app.sync.status}`}
          >
            {app.sync.status}
          </Badge>
          <Badge
            variant={healthBadgeVariant(app.health.status)}
            className={healthBadgeClass(app.health.status)}
            aria-label={`Health status: ${app.health.status}`}
          >
            {app.health.status}
          </Badge>
          {app.operationPhase ? (
            <Badge variant="outline" aria-label={`Operation phase: ${app.operationPhase}`}>
              {app.operationPhase}
            </Badge>
          ) : null}
          <span className="text-muted-foreground text-sm">
            Last sync:{" "}
            <span className="font-mono">
              {app.lastSyncAt ? formatAbsoluteTime(app.lastSyncAt) : "—"}
            </span>
          </span>
        </div>

        {/* Replicas */}
        <div className="text-sm">
          <span className="text-muted-foreground">Replicas: </span>
          <span className="font-mono">{replicasLabel}</span>
        </div>

        {app.health.status === "Degraded" && app.health.message ? (
          <p className="text-destructive text-sm">{app.health.message}</p>
        ) : null}
      </CardContent>

      <HardSyncDialog
        open={hardSyncOpen}
        onOpenChange={(open) => {
          if (!hardSyncMutation.isPending) {
            setHardSyncOpen(open);
          }
        }}
        applicationName={app.name}
        onConfirm={() => hardSyncMutation.mutate()}
        busy={hardSyncMutation.isPending}
      />
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <div className="text-foreground text-sm">{children}</div>
    </div>
  );
}
