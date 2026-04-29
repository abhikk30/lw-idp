export type BuildResult = "SUCCESS" | "FAILURE" | "UNSTABLE" | "ABORTED" | "NOT_BUILT" | "RUNNING";

export interface BuildAction {
  /** Causes of the build (e.g. "Started by user X", "Started by upstream project Y"). */
  causes?: Array<{ shortDescription: string; userId?: string; userName?: string }>;
  /** Build parameters, if any. */
  parameters?: Array<{ name: string; value: string | number | boolean }>;
  /** Git revision and branch info, if the build came from a git checkout. */
  lastBuiltRevision?: { SHA1: string; branch?: Array<{ name: string }> };
}

export interface BuildRun {
  /** Build number, monotonically increasing per job. */
  number: number;
  /** "SUCCESS" | "FAILURE" | "UNSTABLE" | "ABORTED" | "NOT_BUILT" | "RUNNING". */
  result: BuildResult;
  /** Epoch ms when the build started. */
  timestamp: number;
  /** Build duration in ms. 0 for RUNNING builds. */
  duration: number;
  /** Direct link to the Jenkins build page. */
  url: string;
  /** Selected actions: causes, parameters, git revision. */
  actions?: BuildAction[];
}

export interface JenkinsJob {
  name: string;
  url: string;
  description?: string;
  lastBuild?: { number: number; result?: BuildResult; timestamp: number; duration: number };
  lastSuccessfulBuild?: { number: number; timestamp: number };
  healthReport?: Array<{ score: number; description: string }>;
}

export interface JenkinsAdapter {
  /** Fetch job metadata. Throws with status 404 + code "not_found" if job doesn't exist. */
  getJob(name: string): Promise<JenkinsJob>;
  /** Fetch recent N builds (default 20). */
  listBuilds(name: string, limit?: number): Promise<BuildRun[]>;
  /** Trigger a build. Returns the queue location URL. */
  triggerBuild(name: string): Promise<{ location: string }>;
}
