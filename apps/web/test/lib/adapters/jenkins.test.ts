import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createJenkinsAdapter } from "../../../src/lib/adapters/jenkins.js";

const BASE = "http://localhost";

const upstreamJob = {
  name: "checkout",
  url: "http://jenkins.lw-idp.local/job/checkout/",
  description: "checkout service",
  lastBuild: { number: 12, result: "SUCCESS", timestamp: 1_700_000_000_000, duration: 45_000 },
  lastSuccessfulBuild: { number: 12, timestamp: 1_700_000_000_000 },
  healthReport: [{ score: 95, description: "Build stability: No failures" }],
};

const upstreamBuilds = {
  builds: [
    {
      number: 14,
      // null = in progress in upstream Jenkins; adapter must map to "RUNNING"
      result: null,
      timestamp: 1_700_000_300_000,
      duration: 0,
      url: "http://jenkins.lw-idp.local/job/checkout/14/",
      actions: [
        {
          causes: [{ shortDescription: "Started by user alice", userId: "alice" }],
          lastBuiltRevision: { SHA1: "deadbeefcafef00d", branch: [{ name: "refs/heads/main" }] },
        },
      ],
    },
    {
      number: 13,
      result: "FAILURE",
      timestamp: 1_700_000_200_000,
      duration: 30_000,
      url: "http://jenkins.lw-idp.local/job/checkout/13/",
      actions: [],
    },
  ],
};

const server = setupServer(
  http.get(`${BASE}/api/v1/jenkins/jobs/checkout`, () => HttpResponse.json(upstreamJob)),
  http.get(`${BASE}/api/v1/jenkins/jobs/missing`, () =>
    HttpResponse.json(
      { code: "not_found", message: "Jenkins job not found: missing" },
      { status: 404 },
    ),
  ),
  http.get(`${BASE}/api/v1/jenkins/jobs/notconfigured`, () =>
    HttpResponse.json(
      {
        code: "jenkins_not_configured",
        message: "Jenkins API token not yet configured",
      },
      { status: 503 },
    ),
  ),
  http.get(`${BASE}/api/v1/jenkins/jobs/checkout/builds`, () => HttpResponse.json(upstreamBuilds)),
  http.post(`${BASE}/api/v1/jenkins/jobs/checkout/build`, () =>
    HttpResponse.json(
      { status: "queued", location: "http://jenkins.lw-idp.local/queue/item/42/" },
      { status: 201 },
    ),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeAdapter() {
  const wrappedFetch: typeof fetch = (input, init) => {
    const url = typeof input === "string" && input.startsWith("/") ? `${BASE}${input}` : input;
    return globalThis.fetch(url as RequestInfo, init);
  };
  return createJenkinsAdapter(wrappedFetch);
}

describe("JenkinsAdapter — getJob", () => {
  it("happy path: returns mapped JenkinsJob", async () => {
    const adapter = makeAdapter();
    const job = await adapter.getJob("checkout");
    expect(job.name).toBe("checkout");
    expect(job.lastBuild?.number).toBe(12);
    expect(job.lastBuild?.result).toBe("SUCCESS");
    expect(job.lastSuccessfulBuild?.number).toBe(12);
    expect(job.healthReport?.[0]?.score).toBe(95);
  });

  it("upstream 404 — error has status 404 and body.code = not_found", async () => {
    const adapter = makeAdapter();
    await expect(adapter.getJob("missing")).rejects.toMatchObject({
      status: 404,
      body: { code: "not_found" },
    });
  });

  it("upstream 503 jenkins_not_configured — error has status 503 and body.code", async () => {
    const adapter = makeAdapter();
    await expect(adapter.getJob("notconfigured")).rejects.toMatchObject({
      status: 503,
      body: { code: "jenkins_not_configured" },
    });
  });
});

describe("JenkinsAdapter — listBuilds", () => {
  it("maps null result → RUNNING and preserves explicit results", async () => {
    const adapter = makeAdapter();
    const builds = await adapter.listBuilds("checkout");
    expect(builds).toHaveLength(2);
    expect(builds[0]?.number).toBe(14);
    expect(builds[0]?.result).toBe("RUNNING");
    expect(builds[1]?.number).toBe(13);
    expect(builds[1]?.result).toBe("FAILURE");
    // First build has a cause + revision; second has empty actions
    expect(builds[0]?.actions?.[0]?.causes?.[0]?.shortDescription).toBe("Started by user alice");
    expect(builds[0]?.actions?.[0]?.lastBuiltRevision?.SHA1).toBe("deadbeefcafef00d");
  });
});

describe("JenkinsAdapter — triggerBuild", () => {
  it("returns the queue location URL on 201", async () => {
    const adapter = makeAdapter();
    const out = await adapter.triggerBuild("checkout");
    expect(out.location).toBe("http://jenkins.lw-idp.local/queue/item/42/");
  });
});
