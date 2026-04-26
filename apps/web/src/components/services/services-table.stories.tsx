import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ServicesTable, type ServicesTableRow } from "./services-table.client.js";

const sampleRows: ServicesTableRow[] = [
  {
    id: "svc-checkout",
    slug: "checkout",
    name: "Checkout",
    type: "service",
    lifecycle: "production",
    ownerTeamId: "team-payments",
    updatedAt: "2026-04-20T00:00:00Z",
  },
  {
    id: "svc-billing",
    slug: "billing",
    name: "Billing",
    type: "service",
    lifecycle: "production",
    ownerTeamId: "team-payments",
    updatedAt: "2026-04-21T00:00:00Z",
  },
  {
    id: "svc-fraud",
    slug: "fraud-check",
    name: "Fraud Check",
    type: "ml",
    lifecycle: "experimental",
    ownerTeamId: "team-platform",
    updatedAt: "2026-04-22T00:00:00Z",
  },
];

const meta: Meta<typeof ServicesTable> = {
  title: "Services / ServicesTable",
  component: ServicesTable,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ServicesTable>;

export const Rows: Story = {
  args: { initialData: sampleRows },
};

export const Empty: Story = {
  args: { initialData: [] },
};

export const FilteredBySearch: Story = {
  args: { initialData: sampleRows },
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/v1/services", ({ request }) => {
          const url = new URL(request.url);
          const q = url.searchParams.get("q") ?? "";
          const items = sampleRows.filter(
            (s) =>
              s.slug.includes(q.toLowerCase()) || s.name.toLowerCase().includes(q.toLowerCase()),
          );
          return HttpResponse.json({ items, nextCursor: null });
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByLabelText(/search services/i);
    await userEvent.clear(search);
    await userEvent.type(search, "billing");

    await waitFor(
      async () => {
        // After fetch, only "Billing" should remain in visible rows.
        expect(canvas.queryByText("Checkout")).not.toBeInTheDocument();
        expect(await canvas.findByText("Billing")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  },
};
