export type ArgoSyncStatus = "Synced" | "OutOfSync" | "Unknown";
export type ArgoHealthStatus = "Healthy" | "Progressing" | "Degraded" | "Suspended" | "Missing";
export type ArgoOperationPhase = "Running" | "Succeeded" | "Failed" | "Error" | "";

export interface ArgoApplication {
  /** Argo CD Application name. For lw-idp: equals the service slug. */
  name: string;
  sync: {
    status: ArgoSyncStatus;
    /** Git revision currently reconciled. Empty before first sync. */
    revision: string;
  };
  health: {
    status: ArgoHealthStatus;
    /** Argo CD's free-text reason (empty when Healthy). */
    message: string;
  };
  /**
   * Aggregated replica counts from the Argo CD resource tree.
   *
   * NOTE: The basic adapter fills these from the Application response, which
   * does not carry replica counts directly. Both fields default to 0 when the
   * data is not derivable without a separate `/resource-tree` call. Components
   * should render "—" when both values are 0.
   */
  replicas: {
    ready: number;
    desired: number;
  };
  /** ISO-8601 timestamp of the last completed sync, if any. */
  lastSyncAt?: string;
  /** Phase of the most recent operation, if any. */
  operationPhase?: ArgoOperationPhase;
}

export interface ArgoSyncOptions {
  prune?: boolean;
  force?: boolean;
}

/**
 * Trimmed input for `createApplication`. The adapter expands this into the
 * full Argo CD Application JSON shape (project=default, helm valueFiles, sync
 * policy, lw-idp `part-of` label) so callers don't have to know the upstream
 * schema. Shape mirrors what the ApplicationSet template generates so manually
 * registered services behave identically to ApplicationSet-managed ones.
 */
export interface ArgoApplicationCreateSpec {
  /** Argo CD Application name. For lw-idp: equals the catalog service slug. */
  name: string;
  /** Git repo URL (e.g. https://github.com/org/repo.git). */
  repoUrl: string;
  /** Git ref to track (branch, tag, or SHA). Typically "master" or "main". */
  targetRevision: string;
  /** Path inside the repo to the Helm chart (e.g. "charts/checkout"). */
  path: string;
  /** Destination namespace inside the in-cluster Kubernetes target. */
  destinationNamespace: string;
}

export interface ArgoCdAdapter {
  /** List all Argo CD Applications labeled `app.kubernetes.io/part-of: lw-idp`. */
  listApplications(): Promise<ArgoApplication[]>;
  /** Get one Application by name. Throws if not found. */
  getApplication(name: string): Promise<ArgoApplication>;
  /**
   * Trigger a sync. Hard Sync is `{ prune: true, force: true }`. Returns when
   * the upstream operation has been *accepted*, not when it completes.
   */
  sync(name: string, opts?: ArgoSyncOptions): Promise<void>;
  /**
   * Create an Argo CD Application. Used by the IDP's "Register service" form
   * when the user opts in to also create an Argo CD Application in the same
   * submit. Throws on upstream error so callers can surface a partial-success
   * toast (catalog row stays — no rollback).
   */
  createApplication(spec: ArgoApplicationCreateSpec): Promise<void>;
}
