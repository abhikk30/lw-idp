import type { BuildRun, JenkinsJob } from "@lw-idp/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Toaster } from "sonner";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BuildsPanel } from "../../src/components/builds/builds-panel.client.js";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  }),
  usePathname: () => "/services/svc-1/builds",
}));

// jsdom rejects relative URLs in `new Request("/api/v1/...")`. Wrap fetch so
// the adapter's relative URLs resolve against http://localhost. MSW pattern
// `*/api/v1/jenkins/...` matches.
const { fetchAbs } = vi.hoisted(() => {
  return {
    fetchAbs: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" && input.startsWith("/") ? `http://localhost${input}` : input;
      return globalThis.fetch(url as RequestInfo, init);
    },
  };
});

vi.mock("../../src/lib/adapters/jenkins.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/adapters/jenkins.js")>(
    "../../src/lib/adapters/jenkins.js",
  );
  return {
    ...actual,
    createJenkinsAdapter: () => actual.createJenkinsAdapter(fetchAbs as typeof fetch),
  };
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

function makeJob(overrides: Partial<JenkinsJob> = {}): JenkinsJob {
  return {
    name: "checkout",
    url: "http://jenkins.lw-idp.local/job/checkout/",
    description: "checkout service",
    lastBuild: { number: 12, result: "SUCCESS", timestamp: 1_700_000_000_000, duration: 45_000 },
    lastSuccessfulBuild: { number: 12, timestamp: 1_700_000_000_000 },
    healthReport: [{ score: 95, description: "Build stability: No failures" }],
    ...overrides,
  };
}

function makeBuild(overrides: Partial<BuildRun> = {}): BuildRun {
  return {
    number: 12,
    result: "SUCCESS",
    timestamp: 1_700_000_000_000,
    duration: 45_000,
    url: "http://jenkins.lw-idp.local/job/checkout/12/",
    actions: [
      {
        causes: [{ shortDescription: "Started by user alice" }],
        lastBuiltRevision: { SHA1: "abcdef0123456789" },
      },
    ],
    ...overrides,
  };
}

/**
 * Default handlers — return the same initial fixtures so background refetches
 * (initialData → refetch) don't error.
 */
function defaultHandlers(job: JenkinsJob, builds: BuildRun[]) {
  return [
    http.get(`*/api/v1/jenkins/jobs/${job.name}`, () =>
      HttpResponse.json({
        name: job.name,
        url: job.url,
        description: job.description,
        lastBuild: job.lastBuild,
        lastSuccessfulBuild: job.lastSuccessfulBuild,
        healthReport: job.healthReport,
      }),
    ),
    http.get(`*/api/v1/jenkins/jobs/${job.name}/builds`, () =>
      HttpResponse.json({
        builds: builds.map((b) => ({
          number: b.number,
          // RUNNING is represented as null in upstream Jenkins
          result: b.result === "RUNNING" ? null : b.result,
          timestamp: b.timestamp,
          duration: b.duration,
          url: b.url,
          actions: b.actions,
        })),
      }),
    ),
  ];
}

function renderPanel(job: JenkinsJob, builds: BuildRun[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BuildsPanel initialJob={job} initialBuilds={builds} serviceSlug={job.name} />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("BuildsPanel", () => {
  it("renders 3 build rows with correct status pills (SUCCESS, FAILURE, RUNNING)", () => {
    const job = makeJob();
    const builds: BuildRun[] = [
      makeBuild({ number: 14, result: "RUNNING", duration: 0 }),
      makeBuild({ number: 13, result: "FAILURE", duration: 30_000 }),
      makeBuild({ number: 12, result: "SUCCESS", duration: 45_000 }),
    ];
    server.use(...defaultHandlers(job, builds));
    renderPanel(job, builds);

    // Three status pills, each labelled with its result
    expect(screen.getByLabelText(/build status: running/i)).toHaveTextContent("RUNNING");
    expect(screen.getByLabelText(/build status: failure/i)).toHaveTextContent("FAILURE");
    expect(screen.getByLabelText(/build status: success/i)).toHaveTextContent("SUCCESS");

    // Build numbers rendered as links
    expect(screen.getByRole("link", { name: /^#14$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^#13$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^#12$/ })).toBeInTheDocument();

    // Health badge
    expect(screen.getByLabelText(/health score: 95/i)).toHaveTextContent(/Health 95/);
  });

  it("Trigger Build → POSTs to /jenkins/jobs/checkout/build → success toast", async () => {
    const job = makeJob();
    const builds = [makeBuild()];
    let postCalled = false;
    server.use(
      ...defaultHandlers(job, builds),
      http.post("*/api/v1/jenkins/jobs/checkout/build", () => {
        postCalled = true;
        return HttpResponse.json(
          { status: "queued", location: "http://jenkins.lw-idp.local/queue/item/42/" },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPanel(job, builds);

    await user.click(screen.getByRole("button", { name: /trigger build/i }));

    await waitFor(() => {
      expect(postCalled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/build triggered for checkout/i)).toBeInTheDocument();
    });
  });

  it("Trigger Build error → toast.error with the gateway error message", async () => {
    const job = makeJob();
    const builds = [makeBuild()];
    server.use(
      ...defaultHandlers(job, builds),
      http.post("*/api/v1/jenkins/jobs/checkout/build", () =>
        HttpResponse.json(
          { code: "jenkins_unavailable", message: "Jenkins unreachable" },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPanel(job, builds);

    await user.click(screen.getByRole("button", { name: /trigger build/i }));

    await waitFor(() => {
      expect(screen.getByText(/jenkins unreachable/i)).toBeInTheDocument();
    });
  });

  it("Empty builds list → renders the empty-state hint", () => {
    // Build a fresh job without lastBuild/lastSuccessfulBuild — exactOptionalPropertyTypes
    // forbids `undefined` for optional fields, so we omit them entirely.
    const job: JenkinsJob = {
      name: "checkout",
      url: "http://jenkins.lw-idp.local/job/checkout/",
      healthReport: [],
    };
    server.use(...defaultHandlers(job, []));
    renderPanel(job, []);

    expect(screen.getByRole("status")).toHaveTextContent(
      /no builds yet — click trigger build to start one/i,
    );
  });
});
