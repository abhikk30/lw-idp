"use client";

import type { BuildResult, BuildRun, JenkinsJob } from "@lw-idp/contracts";
import { Badge } from "@lw-idp/ui/components/badge";
import { Button } from "@lw-idp/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lw-idp/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { toast } from "sonner";
import { createJenkinsAdapter } from "../../lib/adapters/jenkins.js";

/**
 * P2.1.1 base URL for the Jenkins UI in dev. P3 will swap this for the real
 * domain wired through ingress + cert.
 */
const JENKINS_UI_BASE = "http://jenkins.lw-idp.local";

/** Lightweight relative-time helper from epoch ms (mirrors deployments panel). */
function formatRelativeAge(epochMs: number): string {
  if (!epochMs) {
    return "—";
  }
  const diffSec = Math.round((epochMs - Date.now()) / 1000);
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

/** Format a duration in ms as e.g. "1m 23s" / "45s" / "12ms". */
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) {
    return "—";
  }
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) {
    return `${ms}ms`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** Truncate a string to N chars, suffixing "…". */
function truncate(s: string, n: number): string {
  if (s.length <= n) {
    return s;
  }
  return `${s.slice(0, n - 1)}…`;
}

/** Tailwind tokens for build result pills. */
function resultBadgeClass(result: BuildResult): string {
  switch (result) {
    case "SUCCESS":
      return "border-transparent bg-green-500/10 text-green-700 dark:text-green-400";
    case "FAILURE":
      return "border-transparent bg-destructive/10 text-destructive";
    case "UNSTABLE":
      return "border-transparent bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
    case "ABORTED":
      return "border-transparent bg-muted text-muted-foreground";
    case "RUNNING":
      return "border-transparent bg-blue-500/10 text-blue-700 dark:text-blue-400 animate-pulse";
    default:
      return "";
  }
}

function resultBadgeVariant(
  result: BuildResult,
): "default" | "secondary" | "outline" | "destructive" {
  if (result === "SUCCESS") {
    return "default";
  }
  if (result === "FAILURE") {
    return "destructive";
  }
  if (result === "UNSTABLE") {
    return "secondary";
  }
  if (result === "RUNNING") {
    return "secondary";
  }
  if (result === "NOT_BUILT") {
    return "outline";
  }
  // ABORTED
  return "outline";
}

/** Pick a colour bucket from a Jenkins healthReport score (0–100). */
function healthBadgeClass(score: number): string {
  if (score >= 80) {
    return "border-transparent bg-green-500/10 text-green-700 dark:text-green-400";
  }
  if (score >= 40) {
    return "border-transparent bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
  }
  return "border-transparent bg-destructive/10 text-destructive";
}

function shortRevision(sha: string): string {
  if (!sha) {
    return "";
  }
  return sha.slice(0, 7);
}

function firstCause(run: BuildRun): string {
  const actions = run.actions ?? [];
  for (const action of actions) {
    const cause = action.causes?.[0];
    if (cause?.shortDescription) {
      return cause.shortDescription;
    }
  }
  return "";
}

function firstRevision(run: BuildRun): string {
  const actions = run.actions ?? [];
  for (const action of actions) {
    if (action.lastBuiltRevision?.SHA1) {
      return action.lastBuiltRevision.SHA1;
    }
  }
  return "";
}

export interface BuildsPanelProps {
  initialJob: JenkinsJob;
  initialBuilds: BuildRun[];
  serviceSlug: string;
}

/**
 * Live Jenkins job + recent builds panel. Polls every 15s for builds and
 * 30s for the job summary (running builds change state quickly).
 *
 * Action bar:
 *  - Trigger Build  → adapter.triggerBuild(slug)
 *
 * P2.1.2 will create the first real Jenkinsfile-driven jobs; the gateway
 * proxy already returns 404 for slugs without a corresponding Jenkins job
 * — those are handled at the RSC level (see `builds/page.tsx`).
 */
export function BuildsPanel({
  initialJob,
  initialBuilds,
  serviceSlug,
}: BuildsPanelProps): ReactNode {
  const adapter = useMemo(() => createJenkinsAdapter(), []);
  const queryClient = useQueryClient();

  const { data: job } = useQuery({
    queryKey: ["jenkins-job", serviceSlug],
    queryFn: () => adapter.getJob(serviceSlug),
    initialData: initialJob,
    refetchInterval: 30_000,
  });

  const { data: builds } = useQuery({
    queryKey: ["jenkins-builds", serviceSlug],
    queryFn: () => adapter.listBuilds(serviceSlug, 20),
    initialData: initialBuilds,
    refetchInterval: 15_000,
  });

  const triggerMutation = useMutation({
    mutationFn: () => adapter.triggerBuild(serviceSlug),
    onSuccess: () => {
      toast(`Build triggered for ${serviceSlug} — check Jenkins for queue position`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Trigger failed";
      toast.error(message);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["jenkins-builds", serviceSlug] });
      void queryClient.invalidateQueries({ queryKey: ["jenkins-job", serviceSlug] });
    },
  });

  const currentJob = job ?? initialJob;
  const currentBuilds = builds ?? initialBuilds;
  const healthScore = currentJob.healthReport?.[0]?.score;
  const healthDescription = currentJob.healthReport?.[0]?.description;
  const lastSuccessful = currentJob.lastSuccessfulBuild;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Builds</CardTitle>
          <CardDescription>
            Recent Jenkins runs for <span className="font-mono">{currentJob.name}</span>.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
            {triggerMutation.isPending ? "Triggering…" : "Trigger Build"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Header strip */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {typeof healthScore === "number" ? (
            <Badge
              variant="outline"
              className={healthBadgeClass(healthScore)}
              aria-label={`Health score: ${healthScore}`}
              title={healthDescription ?? `Score ${healthScore}/100`}
            >
              Health {healthScore}
            </Badge>
          ) : null}
          {lastSuccessful ? (
            <span className="text-muted-foreground">
              Last successful: <span className="font-mono">#{lastSuccessful.number}</span>
              {", "}
              {formatRelativeAge(lastSuccessful.timestamp)}
            </span>
          ) : (
            <span className="text-muted-foreground italic">No successful build yet</span>
          )}
          <a
            href={`${JENKINS_UI_BASE}/job/${encodeURIComponent(serviceSlug)}/`}
            target="_blank"
            rel="noreferrer"
            className="text-primary ml-auto hover:underline"
          >
            Open in Jenkins →
          </a>
        </div>

        {/* Builds table */}
        {currentBuilds.length === 0 ? (
          <output className="text-muted-foreground block rounded-md border p-4 text-sm">
            No builds yet — click Trigger Build to start one.
          </output>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Cause</TableHead>
                <TableHead>Revision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentBuilds.map((run) => {
                const cause = firstCause(run);
                const truncatedCause = cause ? truncate(cause, 40) : "";
                const sha = firstRevision(run);
                return (
                  <TableRow key={run.number}>
                    <TableCell>
                      <a
                        href={run.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary font-mono hover:underline"
                      >
                        #{run.number}
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={resultBadgeVariant(run.result)}
                        className={resultBadgeClass(run.result)}
                        aria-label={`Build status: ${run.result}`}
                      >
                        {run.result}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatRelativeAge(run.timestamp)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {run.result === "RUNNING" ? "—" : formatDuration(run.duration)}
                    </TableCell>
                    <TableCell className="text-sm" title={cause}>
                      {truncatedCause || <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {sha ? shortRevision(sha) : ""}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
