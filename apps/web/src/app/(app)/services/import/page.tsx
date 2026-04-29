import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  type ImportCandidate,
  ImportTable,
  type ImportTeamRef,
} from "../../../../components/services/import-table.client.js";
import { getServerSession } from "../../../../lib/auth/server.js";

export const dynamic = "force-dynamic";

const INTERNAL_BASE_URL =
  process.env.GATEWAY_INTERNAL_URL ?? "http://gateway-svc.lw-idp.svc.cluster.local/api/v1";

interface CandidatesPayload {
  candidates: ImportCandidate[];
}

interface LoadResult {
  candidates: ImportCandidate[];
  /** True when gateway responded 503 deploy_plane_unavailable. */
  deployPlaneUnavailable: boolean;
  /** Other error to surface as a banner. */
  error?: string;
}

async function loadCandidates(): Promise<LoadResult> {
  const reqHeaders = await headers();
  const cookie = reqHeaders.get("cookie") ?? "";
  try {
    const res = await fetch(`${INTERNAL_BASE_URL}/services/import-candidates`, {
      headers: { ...(cookie ? { cookie } : {}), accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 503) {
      return { candidates: [], deployPlaneUnavailable: true };
    }
    if (!res.ok) {
      return {
        candidates: [],
        deployPlaneUnavailable: false,
        error: `gateway ${res.status}`,
      };
    }
    const body = (await res.json()) as CandidatesPayload;
    return { candidates: body.candidates ?? [], deployPlaneUnavailable: false };
  } catch (err) {
    return {
      candidates: [],
      deployPlaneUnavailable: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export default async function ServicesImportPage(): Promise<ReactNode> {
  const [{ candidates, deployPlaneUnavailable, error }, session] = await Promise.all([
    loadCandidates(),
    getServerSession(),
  ]);

  const teams: ImportTeamRef[] = (session?.teams ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/services"
          className="text-muted-foreground hover:text-foreground w-fit text-sm"
        >
          ← Back to services
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Import from Argo CD</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Argo CD Applications that don't yet have a catalog entry. Click Import to create one.
        </p>
      </div>

      {deployPlaneUnavailable ? (
        <div
          className="border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 rounded-md border p-4 text-sm"
          role="alert"
          data-testid="deploy-plane-unavailable-banner"
        >
          Deploy plane unavailable — please retry.
        </div>
      ) : null}

      {error && !deployPlaneUnavailable ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-4 text-sm"
          role="alert"
        >
          Failed to load import candidates: {error}
        </div>
      ) : null}

      {teams.length === 0 ? (
        <div
          className="border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300 rounded-md border p-4 text-sm"
          role="alert"
          data-testid="no-teams-banner"
        >
          You must belong to a team to import services. Ask an admin to add you to a team.
        </div>
      ) : null}

      <ImportTable initialCandidates={candidates} teams={teams} />
    </div>
  );
}
