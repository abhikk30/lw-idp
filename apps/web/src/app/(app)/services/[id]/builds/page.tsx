import type { BuildRun, JenkinsJob } from "@lw-idp/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import type { ReactNode } from "react";
import { BuildsPanel } from "../../../../../components/builds/builds-panel.client.js";
import { getJenkinsAdapter } from "../../../../../lib/adapters/index.js";
import { createServerClient } from "../../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface AdapterError extends Error {
  status?: number;
  body?: { code?: string; message?: string };
}

function isAdapterError(err: unknown): err is AdapterError {
  return err instanceof Error;
}

/**
 * Per-service Builds page.
 *
 * Renders the live Jenkins job summary + recent runs. Convention: Jenkins job
 * name == catalog service slug.
 *
 * Behaviour on adapter failure (distinguished by `err.status` + `err.body.code`):
 *  - 503 jenkins_not_configured  → "API token not configured" card pointing
 *                                   at the runbook.
 *  - 404 not_found from getJob   → "No Jenkins job for this service yet" card
 *                                   linking to Jenkins newJob.
 *  - 503 jenkins_unavailable /
 *    503 jenkins_unauthorized    → "Jenkins unreachable — please retry" card.
 *  - any other error             → generic "Failed to load builds: {message}".
 */
export default async function BuildsPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;

  // Resolve the service slug — Jenkins job name == slug.
  const client = await createServerClient();
  const { data: service } = await client.GET("/services/{id}", { params: { path: { id } } });
  const slug = service?.slug ?? id;

  const adapter = await getJenkinsAdapter();
  let initialJob: JenkinsJob;
  let initialBuilds: BuildRun[];
  try {
    [initialJob, initialBuilds] = await Promise.all([
      adapter.getJob(slug),
      adapter.listBuilds(slug, 20),
    ]);
  } catch (err) {
    return renderError(err, slug);
  }

  return <BuildsPanel initialJob={initialJob} initialBuilds={initialBuilds} serviceSlug={slug} />;
}

function renderError(err: unknown, slug: string): ReactNode {
  if (!isAdapterError(err)) {
    return (
      <EmptyCard title="Builds unavailable" description="Failed to load builds: unknown error." />
    );
  }
  const status = err.status;
  const code = err.body?.code;
  const message = err.message;

  if (status === 503 && code === "jenkins_not_configured") {
    return (
      <EmptyCard
        title="Jenkins API token not configured"
        description="An admin needs to follow the runbook once per cluster to wire the Jenkins API token Secret. See docs/runbooks/jenkins-api-token.md."
      />
    );
  }
  if (status === 404 || code === "not_found") {
    return (
      <EmptyCard
        title="No Jenkins job for this service yet"
        description={
          <>
            Create one in Jenkins to start building <span className="font-mono">{slug}</span>.{" "}
            <a
              className="text-primary hover:underline"
              href="http://jenkins.lw-idp.local/newJob"
              target="_blank"
              rel="noreferrer"
            >
              Open Jenkins →
            </a>
          </>
        }
      />
    );
  }
  if (status === 503 && (code === "jenkins_unavailable" || code === "jenkins_unauthorized")) {
    return (
      <EmptyCard
        title="Jenkins unreachable"
        description="Jenkins is currently unreachable — please retry."
      />
    );
  }
  return <EmptyCard title="Builds unavailable" description={`Failed to load builds: ${message}`} />;
}

function EmptyCard({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="text-sm">{description}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
