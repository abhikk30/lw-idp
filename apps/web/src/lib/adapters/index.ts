import "server-only";

import type { ArgoCdAdapter, DeploymentAdapter, PipelineAdapter } from "@lw-idp/contracts";
import { createServerArgoCdAdapter } from "./argocd.server.js";
import { mockDeploymentAdapter } from "./deployments.mock.js";
import { mockPipelineAdapter } from "./pipelines.mock.js";

/**
 * Returns the configured deployment adapter.
 *
 * P1.7 ships ONLY the mock adapter. Real ArgoCD adapter ships in P3 — at
 * which point this selector becomes a runtime feature flag check
 * (NEXT_PUBLIC_INTEG_DEPLOYMENTS=mock|argo).
 */
export function getDeploymentAdapter(): DeploymentAdapter {
  return mockDeploymentAdapter;
}

export function getPipelineAdapter(): PipelineAdapter {
  return mockPipelineAdapter;
}

/**
 * Returns the real Argo CD adapter backed by the gateway proxy routes.
 * SERVER-side variant: uses absolute internal-DNS URL + forwards the
 * inbound request's `cookie` header via `next/headers`. Async because
 * `headers()` is async in Next 15.
 *
 * Client components must use `createArgoCdAdapter()` from `./argocd.js`
 * directly — that variant uses relative URLs + `credentials: "same-origin"`
 * which only works in the browser context.
 */
export async function getArgoCdAdapter(): Promise<ArgoCdAdapter> {
  return await createServerArgoCdAdapter();
}
