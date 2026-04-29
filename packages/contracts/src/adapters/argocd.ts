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
}
