import "server-only";

import type {
  BuildAction,
  BuildResult,
  BuildRun,
  JenkinsAdapter,
  JenkinsJob,
} from "@lw-idp/contracts";
import { headers } from "next/headers";

/**
 * Server-side Jenkins adapter for use in RSC, Route Handlers, Server Actions.
 *
 * Differs from the client-side `createJenkinsAdapter()` in two ways:
 *  - Uses absolute URL pointing at the gateway's internal DNS (no relative
 *    `/api/v1/...` because there's no browser origin in RSC context).
 *  - Forwards the inbound request's `cookie` header explicitly via
 *    `next/headers`, so the gateway sees the authenticated session.
 *
 * Mirrors the pattern used by `argocd.server.ts`.
 */

interface UpstreamCause {
  shortDescription?: string;
  userId?: string;
  userName?: string;
}

interface UpstreamParameter {
  name?: string;
  value?: string | number | boolean;
}

interface UpstreamBranch {
  name?: string;
}

interface UpstreamLastBuiltRevision {
  SHA1?: string;
  branch?: UpstreamBranch[];
}

interface UpstreamAction {
  causes?: UpstreamCause[];
  parameters?: UpstreamParameter[];
  lastBuiltRevision?: UpstreamLastBuiltRevision;
}

interface UpstreamBuild {
  number?: number;
  result?: string | null;
  timestamp?: number;
  duration?: number;
  url?: string;
  actions?: UpstreamAction[];
}

interface UpstreamBuildsResponse {
  builds?: UpstreamBuild[];
}

interface UpstreamJob {
  name?: string;
  url?: string;
  description?: string;
  lastBuild?: {
    number?: number;
    result?: string | null;
    timestamp?: number;
    duration?: number;
  };
  lastSuccessfulBuild?: { number?: number; timestamp?: number };
  healthReport?: Array<{ score?: number; description?: string }>;
}

interface UpstreamTrigger {
  status?: string;
  location?: string;
}

const INTERNAL_BASE_URL = (
  process.env.GATEWAY_INTERNAL_URL?.replace(/\/api\/v1$/, "") ??
  "http://gateway-svc.lw-idp.svc.cluster.local"
).replace(/\/+$/, "");

const KNOWN_RESULTS: ReadonlySet<BuildResult> = new Set<BuildResult>([
  "SUCCESS",
  "FAILURE",
  "UNSTABLE",
  "ABORTED",
  "NOT_BUILT",
  "RUNNING",
]);

function toBuildResult(raw: string | null | undefined): BuildResult {
  if (raw === null || raw === undefined) {
    return "RUNNING";
  }
  if ((KNOWN_RESULTS as ReadonlySet<string>).has(raw)) {
    return raw as BuildResult;
  }
  return "NOT_BUILT";
}

function mapAction(raw: UpstreamAction): BuildAction {
  const action: BuildAction = {};
  if (raw.causes && raw.causes.length > 0) {
    action.causes = raw.causes
      .filter(
        (c): c is UpstreamCause & { shortDescription: string } =>
          typeof c.shortDescription === "string",
      )
      .map((c) => {
        const out: { shortDescription: string; userId?: string; userName?: string } = {
          shortDescription: c.shortDescription,
        };
        if (c.userId !== undefined) {
          out.userId = c.userId;
        }
        if (c.userName !== undefined) {
          out.userName = c.userName;
        }
        return out;
      });
  }
  if (raw.parameters && raw.parameters.length > 0) {
    action.parameters = raw.parameters
      .filter(
        (p): p is UpstreamParameter & { name: string; value: string | number | boolean } =>
          typeof p.name === "string" && p.value !== undefined,
      )
      .map((p) => ({ name: p.name, value: p.value }));
  }
  if (raw.lastBuiltRevision?.SHA1) {
    const rev: BuildAction["lastBuiltRevision"] = { SHA1: raw.lastBuiltRevision.SHA1 };
    if (raw.lastBuiltRevision.branch && raw.lastBuiltRevision.branch.length > 0) {
      rev.branch = raw.lastBuiltRevision.branch
        .filter((b): b is UpstreamBranch & { name: string } => typeof b.name === "string")
        .map((b) => ({ name: b.name }));
    }
    action.lastBuiltRevision = rev;
  }
  return action;
}

function mapBuild(raw: UpstreamBuild): BuildRun {
  const run: BuildRun = {
    number: raw.number ?? 0,
    result: toBuildResult(raw.result),
    timestamp: raw.timestamp ?? 0,
    duration: raw.duration ?? 0,
    url: raw.url ?? "",
  };
  if (raw.actions && raw.actions.length > 0) {
    const mapped = raw.actions
      .map(mapAction)
      .filter((a) => a.causes || a.parameters || a.lastBuiltRevision);
    if (mapped.length > 0) {
      run.actions = mapped;
    }
  }
  return run;
}

function mapJob(raw: UpstreamJob): JenkinsJob {
  const job: JenkinsJob = {
    name: raw.name ?? "",
    url: raw.url ?? "",
  };
  if (raw.description !== undefined) {
    job.description = raw.description;
  }
  if (raw.lastBuild && raw.lastBuild.number !== undefined) {
    const lb: JenkinsJob["lastBuild"] = {
      number: raw.lastBuild.number,
      timestamp: raw.lastBuild.timestamp ?? 0,
      duration: raw.lastBuild.duration ?? 0,
    };
    if (raw.lastBuild.result !== undefined) {
      lb.result = toBuildResult(raw.lastBuild.result);
    }
    job.lastBuild = lb;
  }
  if (raw.lastSuccessfulBuild && raw.lastSuccessfulBuild.number !== undefined) {
    job.lastSuccessfulBuild = {
      number: raw.lastSuccessfulBuild.number,
      timestamp: raw.lastSuccessfulBuild.timestamp ?? 0,
    };
  }
  if (raw.healthReport && raw.healthReport.length > 0) {
    job.healthReport = raw.healthReport
      .filter(
        (h): h is { score: number; description: string } =>
          typeof h.score === "number" && typeof h.description === "string",
      )
      .map((h) => ({ score: h.score, description: h.description }));
  }
  return job;
}

export async function createServerJenkinsAdapter(): Promise<JenkinsAdapter> {
  const reqHeaders = await headers();
  const cookie = reqHeaders.get("cookie") ?? "";
  const baseHeaders: HeadersInit = cookie
    ? { cookie, accept: "application/json" }
    : { accept: "application/json" };

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${INTERNAL_BASE_URL}${path}`, {
      headers: baseHeaders,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(
        new Error((body as { message?: string }).message ?? `HTTP ${res.status}`),
        { status: res.status, body },
      );
    }
    return res.json() as Promise<T>;
  }

  return {
    async getJob(name: string): Promise<JenkinsJob> {
      const data = await getJson<UpstreamJob>(`/api/v1/jenkins/jobs/${encodeURIComponent(name)}`);
      return mapJob(data);
    },

    async listBuilds(name: string, limit = 20): Promise<BuildRun[]> {
      const data = await getJson<UpstreamBuildsResponse>(
        `/api/v1/jenkins/jobs/${encodeURIComponent(name)}/builds?limit=${limit}`,
      );
      return (data.builds ?? []).map(mapBuild);
    },

    async triggerBuild(name: string): Promise<{ location: string }> {
      const res = await fetch(
        `${INTERNAL_BASE_URL}/api/v1/jenkins/jobs/${encodeURIComponent(name)}/build`,
        {
          method: "POST",
          headers: baseHeaders,
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(
          new Error((body as { message?: string }).message ?? `HTTP ${res.status}`),
          { status: res.status, body },
        );
      }
      const body = (await res.json().catch(() => ({}))) as UpstreamTrigger;
      return { location: body.location ?? "" };
    },
  };
}
