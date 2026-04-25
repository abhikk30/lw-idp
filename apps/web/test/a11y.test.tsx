// F3 — vitest-axe accessibility assertions on key client components.
//
// Strategy: render each component in a minimal QueryClientProvider wrapper
// (same shape as F1's RTL tests) and feed the resulting container to axe-core
// via `vitest-axe`. We don't exercise interactions here — axe-core reports
// static-DOM a11y violations after the initial render is complete.
//
// The api-client singleton is mocked the same way the F1 tests mock it:
// jsdom rejects relative URLs in `new Request(...)`, so we hand the component
// a client with an absolute base URL.

import type { paths } from "@lw-idp/contracts/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import createClient from "openapi-fetch";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
// `vitest-axe/matchers` has `export type *` in its .d.ts, so the value-export
// `toHaveNoViolations` is invisible to TS via that subpath. Reach into the
// dist file directly (where it's a real function) to keep typecheck green.
import { toHaveNoViolations } from "vitest-axe/dist/matchers.js";

// Augment Chai's Assertion (vitest extends Chai). Both `interface Assertion`
// and `interface Assert` accept extension here without colliding with vitest's
// `declare module 'vitest'` Assertion<T> declaration.
declare global {
  namespace Chai {
    interface Assertion {
      toHaveNoViolations(): void;
    }
  }
}

expect.extend({ toHaveNoViolations });

// `color-contrast` requires actual rendered colors via canvas, which jsdom
// doesn't implement — disable it to avoid `HTMLCanvasElement.getContext`
// warnings on stderr. Color-contrast is validated by Playwright/CI, not here.
const axeOptions = { rules: { "color-contrast": { enabled: false } } } as const;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  }),
  usePathname: () => "/",
}));

const { mockedClient } = vi.hoisted(() => {
  return { mockedClient: { current: null as ReturnType<typeof createClient<paths>> | null } };
});
vi.mock("../src/lib/api/client.js", () => ({
  apiClient: () => {
    if (!mockedClient.current) {
      mockedClient.current = createClient<paths>({
        baseUrl: "http://localhost/api/v1",
        credentials: "same-origin",
      });
    }
    return mockedClient.current;
  },
}));

afterEach(cleanup);

function renderWithQuery(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("a11y — key components", () => {
  it("ServicesTable has no violations", async () => {
    const { ServicesTable } = await import("../src/components/services/services-table.client.js");
    const { container } = renderWithQuery(<ServicesTable initialData={[]} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("ServiceForm has no violations", async () => {
    const { ServiceForm } = await import("../src/components/services/service-form.client.js");
    const teams = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "platform-admins",
        name: "Platform Admins",
      },
    ];
    const { container } = renderWithQuery(<ServiceForm teams={teams} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("ClustersTable has no violations", async () => {
    const { ClustersTable } = await import("../src/components/clusters/clusters-table.client.js");
    const { container } = renderWithQuery(<ClustersTable initialData={[]} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("ClusterForm has no violations", async () => {
    const { ClusterForm } = await import("../src/components/clusters/cluster-form.client.js");
    const { container } = renderWithQuery(<ClusterForm />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
