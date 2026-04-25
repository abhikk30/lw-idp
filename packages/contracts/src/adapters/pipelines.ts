export type PipelineStatus = "success" | "failed" | "running";

export interface Pipeline {
  id: string;
  serviceSlug: string;
  branch: string;
  status: PipelineStatus;
  triggeredBy: string;
  createdAt: string;
  durationSeconds: number;
}

export interface PipelineList {
  items: Pipeline[];
}

export interface PipelineAdapter {
  list(serviceSlug: string): Promise<PipelineList>;
  get(id: string): Promise<Pipeline>;
}
