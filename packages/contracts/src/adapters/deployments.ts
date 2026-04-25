export type DeploymentEnvironment = "prod" | "stage" | "dev";
export type DeploymentStatus = "succeeded" | "failed" | "in_progress";

export interface Deployment {
  id: string;
  serviceSlug: string;
  environment: DeploymentEnvironment;
  status: DeploymentStatus;
  commitSha: string;
  createdAt: string; // ISO timestamp
  durationSeconds: number;
}

export interface DeploymentList {
  items: Deployment[];
}

export interface DeploymentTriggerOptions {
  environment: DeploymentEnvironment;
  commitSha?: string;
}

export interface DeploymentAdapter {
  list(serviceSlug: string): Promise<DeploymentList>;
  get(id: string): Promise<Deployment>;
  trigger(serviceSlug: string, opts: DeploymentTriggerOptions): Promise<Deployment>;
}
