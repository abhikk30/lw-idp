import "server-only";

import type { ArgoCdAdapter, DeploymentAdapter, PipelineAdapter } from "@lw-idp/contracts";
import { createArgoCdAdapter } from "./argocd.js";
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
 * Always returns the live implementation — no mock variant (Argo CD is
 * always present in any running cluster).
 */
export function getArgoCdAdapter(): ArgoCdAdapter {
  return createArgoCdAdapter();
}
