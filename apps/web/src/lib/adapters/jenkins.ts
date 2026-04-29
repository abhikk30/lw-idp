import type {
  BuildAction,
  BuildResult,
  BuildRun,
  JenkinsAdapter,
  JenkinsJob,
} from "@lw-idp/contracts";

// ---------------------------------------------------------------------------
// Upstream Jenkins response shapes (minimal — only fields we read)
// ---------------------------------------------------------------------------

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
  /** Jenkins returns null for in-progress builds. */
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

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const KNOWN_RESULTS: ReadonlySet<BuildResult> = new Set<BuildResult>([
  "SUCCESS",
  "FAILURE",
  "UNSTABLE",
  "ABORTED",
  "NOT_BUILT",
  "RUNNING",
]);

/**
 * Jenkins reports `result: null` for in-progress builds — map it to "RUNNING".
 * Other values pass through (Jenkins uses uppercase enum values that match
 * our BuildResult type).
 */
function toBuildResult(raw: string | null | undefined): BuildResult {
  if (raw === null || raw === undefined) {
    return "RUNNING";
  }
  if ((KNOWN_RESULTS as ReadonlySet<string>).has(raw)) {
    return raw as BuildResult;
  }
  // Unknown — treat as NOT_BUILT (defensive default).
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a real JenkinsAdapter that calls the gateway proxy routes at
 * `/api/v1/jenkins/*`. The `lw-sid` cookie is forwarded automatically via
 * `credentials: "same-origin"`.
 *
 * Errors thrown carry a `status` field (e.g. 404, 503) and a `body` field
 * with the gateway's `{ code, message }` envelope so the UI can distinguish
 * jenkins_not_configured (503) from not_found (404) when picking which empty
 * state to render.
 */
export function createJenkinsAdapter(
  /** Override for tests — defaults to `globalThis.fetch`. */
  fetchImpl: typeof fetch = globalThis.fetch,
): JenkinsAdapter {
  const base = "/api/v1";

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      credentials: "same-origin",
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
      const data = await getJson<UpstreamJob>(`/jenkins/jobs/${encodeURIComponent(name)}`);
      return mapJob(data);
    },

    async listBuilds(name: string, limit = 20): Promise<BuildRun[]> {
      const data = await getJson<UpstreamBuildsResponse>(
        `/jenkins/jobs/${encodeURIComponent(name)}/builds?limit=${limit}`,
      );
      return (data.builds ?? []).map(mapBuild);
    },

    async triggerBuild(name: string): Promise<{ location: string }> {
      const res = await fetchImpl(`${base}/jenkins/jobs/${encodeURIComponent(name)}/build`, {
        method: "POST",
        credentials: "same-origin",
      });
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
